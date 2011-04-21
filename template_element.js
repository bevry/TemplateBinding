// Copyright 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var HTMLTemplateElement;

(function() {

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

document.addEventListener('DOMContentLoaded', function(e) {
  var templates = document.querySelectorAll('template');
  forEach(templates, HTMLTemplateElement.decorate);
}, false);

function hasPlaceHolder(text) {
  return /\{\{((.|\n)+?)\}\}/.test(text);
}

function getPropertyNameForBinding(nodeName) {
  if (nodeName == 'modelscope')
    return 'modelScope';
  return nodeName;
}

/**
 * Builds a structure that represents the position of the bindings in this DOM
 * tree.
 * @param {Node} node The node to generate the representation for.
 * @return {Object}
 */
function buildBindingsRepresentation(node) {
  var bindings = {};
  var anyBindings = false;
  var anyTemplates = false;
  var modelScope = '';
  if (node.nodeType == Node.ELEMENT_NODE) {

    for (var i = 0; i < node.attributes.length; i++) {
      var attr = node.attributes[i];
      if (hasPlaceHolder(attr.nodeValue)) {
        var propertyName = getPropertyNameForBinding(attr.nodeName);
        bindings[propertyName] = attr.nodeValue;
        anyBindings = true;
      } else if (attr.nodeName == 'modelscope') {
        modelScope = attr.nodeValue;
      }
    }
  } else if (node.nodeType == Node.TEXT_NODE) {
    if (hasPlaceHolder(node.textContent)) {
      bindings['textContent'] = node.textContent;
      anyBindings = true;
    }
  }

  var descr = {};
  var anyNested = false;
  // Don't traverse into templates. Templates gets stamped out by the iterator.
  if (node.tagName != 'TEMPLATE') {
    for (var i = 0; i < node.childNodes.length; i++) {
      var repr = buildBindingsRepresentation(node.childNodes[i]);
      if (repr) {
        descr[i] = repr;
        anyNested = true;
      }
    }
  } else {
    anyTemplates = true;
  }

  if (!anyBindings && !anyNested && !anyTemplates)
    return null;

  if (anyBindings)
    descr.bindings_ = bindings;
  if (modelScope)
    descr.modelScope = modelScope;
  return descr;
}

/**
 * This creates a data structure containting the phantom bindings from a binding
 * description. This data structure looks enough like a DOM tree as needed by
 * the bindings (parentElement, templateScope_ and modelScope). Once the DOM is
 * ready this data structure is traversed and the bindings are transferred to
 * the DOM.
 * @param {Object} desc The binding description.
 * @param {Object} parent The parent element or phantom element.
 * @param {string} templateScope The template scope.
 * @return {object} An object similar to the binding description except that it
 *     has bindings in it.
 */
function createPhantomInstance(desc, parent, templateScope) {
  var phantom = {};
  for (var key in desc) {
    phantom[key] = createPhantomInstanceInner(desc[key], parent, templateScope);
  }
  return phantom;
}

function createPhantomInstanceInner(desc, parent, opt_templateScope) {
  var phantom = {
    parentElement: parent
  };

  if (opt_templateScope)
    phantom.templateScope_ = opt_templateScope;

  // This needs to happen first because the b.bindTo() below in
  // case: 'bindings_' depends on it being set properly.
  if ('modelScope' in desc) {
    phantom.modelScope = desc.modelScope;
  }

  for (var key in desc) {
    switch (key) {
      case 'bindings_':
        phantom.bindings_ = {};
        for (var name in desc.bindings_) {
          var b = phantom.bindings_[name] =
              new PlaceHolderBinding(desc.bindings_[name]);
          b.sync_ = false;
          b.bindTo(phantom, name);
        }
        break;

      case 'modelScope':
        break; // Already done above. Ignore.

      default:
        phantom[key] = createPhantomInstanceInner(desc[key], phantom);
    }
  }

  return phantom;
}

function isIndex(s) {
  // toUint32: s >>> 0
  return s == String(s >>> 0);
}

/**
 * This transfers the temporary bindings to a node and its subtree.
 * @param {Node} node The node to transfer the bindings to.
 * @param {Object} phantom The object with the bindings.
 */
function transferBindingsToNode(node, phantom) {
  if (!phantom)
    return;

  for (var key in phantom) {
    switch (key) {
      case 'bindings_':
        node.bindings_ = node.bindings_ || {};
        for (var name in phantom.bindings_) {
          var b = node.bindings_[name] = phantom.bindings_[name];
          b.rebindTo(node);
          b.sync_ = true;
        }
        break;

      case 'templateScope_':
        node.templateScope_ = phantom.templateScope_;
        break;

      default:
        if (isIndex(key))
          transferBindingsToNode(node.childNodes[key], phantom[key]);
    }
  }
}

/**
 * Creates a snapshot of the DOM and binding descriptions for a template and
 * puts it on the iterator for that template.
 * @param {TemplateIterator} iterator
 */
function createSnapshot(iterator) {
  var templateElement = iterator.templateElement;

  var df = iterator.templateDom_ =
      templateElement.ownerDocument.createDocumentFragment();
  var bindings = iterator.bindingDescriptions_ = {};
  var i = 0;

  function recursiveExtract(template) {
    HTMLTemplateElement.decorate(template);
    // Getting the template iterator creates it if does not already exist.
    template.templateIterator;
  }

  while (templateElement.hasChildNodes()) {
    // Move original element to the snapshot document fragment.
    var child = df.appendChild(templateElement.firstChild);
    var b = buildBindingsRepresentation(child);
    if (b)
      bindings[i] = b
    i++;

    // Find template nodes and extract their DOM too.
    if (child.nodeType == Node.ELEMENT_NODE) {
      if (child.tagName == 'TEMPLATE') {
        recursiveExtract(child);
      } else {
        var templates = child.querySelectorAll(':not(template) template');
        forEach(templates, recursiveExtract);
      }
    }
  }
}

/**
 * Recursively removes all bindings from a DOM tree.
 * @param {Node} node The root of the tree to remove the bindings for.
 */
function removeBindings(node) {
  // TODO(arv): This should use the binding description to reduce DOM walking.
  for (var prop in node.bindings_) {
    node.removeBinding(prop);
  }

  for (var i = 0; i < node.childNodes.length; i++) {
    removeBindings(node.childNodes[i]);
  }
}

/**
 * Destructs all template iterators in a DOM tree.
 * @param {Node} node The root of the tree to destruct he templates for.
 */
function destructTemplates(node) {
  if (node.nodeType != Node.ELEMENT_NODE)
    return;

  function destructTemplate(el) {
    if (el.templateIterator_)
      el.templateIterator_.destruct();
  }

  var templates = node.querySelectorAll('template');
  for (var i = templates.length - 1; i >= 0; i--) {
    destructTemplate(templates[i]);
  }

  if (node.tagName == 'TEMPLATE')
    destructTemplate(node);
}

function inDocument(node) {
  return node.ownerDocument.compareDocumentPosition(node) &
      Node.DOCUMENT_POSITION_CONTAINED_BY;
}


/**
 * This represents a <template> element.
 * @constructor
 * @extends {HTMLElement}
 */
HTMLTemplateElement = function() {
  var el = document.createElement('template');
  HTMLTemplateElement.decorate(el);
  return el;
};

HTMLTemplateElement.decorate = function(el) {
  if (el instanceof HTMLTemplateElement)
    return;

  el.__proto__ = HTMLTemplateElement.prototype;
  el.decorate();
};

var htmlElement = this.HTMLUnknownElement || HTMLElement;

HTMLTemplateElement.prototype = {
  // Gecko is more picky with the prototype than WebKit. Make sure to use the
  // same prototype as created in the constructor.
  __proto__: htmlElement.prototype,

  decorate: function() {
    this.maybeApplyTemplate_();
  },

  get instantiate() {
    return this.getAttribute('instantiate');
  },

  set instantiate(instantiate) {
    var oldVal = this.instantiate;
    if (instantiate == null)
      this.removeAttribute('instantiate');
    else
      this.setAttribute('instantiate', instantiate);
    if (instantiate != oldVal) {
      this.removeAttribute('iterate');
      this.maybeApplyTemplate_();
    }
  },

  get iterate() {
    return this.getAttribute('iterate');
  },

  set iterate(iterate) {
    var oldVal = this.iterate;
    if (iterate == null)
      this.removeAttribute('iterate');
    else
      this.setAttribute('iterate', iterate);
    if (iterate != oldVal) {
      this.removeAttribute('instantiate');
      this.maybeApplyTemplate_();
    }
  },

  get ref() {
    var ref = this.getAttribute('ref');
    return ref ? this.ownerDocument.getElementById(ref) : null;
  },

  templateIterator_: null,

  get templateIterator() {
    // new TemplateIterator sets templateIterator_.
    return this.templateIterator_ || new TemplateIterator(this);
  },

  maybeApplyTemplate_: function() {
    // Templates that are not in the document should not yet be started.
    if (!inDocument(this))
      return;

    this.templateIterator.start();
  }
};


/**
 * The class responsible for building a template.
 * @param {HTMLTemplateElement} templateElement The template element this
 *     builds instances for.
 * @param {TemplateIterator=} opt_fromIterator This is used when the template
 *     iterator is created from another iterator so that we can reference the
 *     other iterators snapshot.
 * @constructor
 */
function TemplateIterator(templateElement, opt_fromIterator) {
  this.instancesToRemove_ = [];
  templateElement.templateIterator_ = this;
  this.templateElement = templateElement;

  this.boundHandleModelMutation = this.handleModelMutation.bind(this);
  this.boundHandleNewModel = this.handleNewModel.bind(this);

  if (opt_fromIterator) {
    this.templateDom_ = opt_fromIterator.templateDom;
    this.bindingDescriptions_ = opt_fromIterator.bindingDescriptions;
  } else {
    // Get these to get them to cache...
    this.templateDom;
    this.bindingDescriptions;
  }
}

function isIterateTemplate(iterator) {
  return iterator.templateElement.iterate !== null;
}

TemplateIterator.prototype = {
  firstInstance_: null,
  lastInstance_: null,
  instancesToRemove_: null,

  get templateDom() {
    if (this.templateDom_)
      return this.templateDom_;

    var ref = this.templateElement.ref;
    if (ref)
      return this.templateDom_ = ref.templateIterator.templateDom;

    createSnapshot(this);
    return this.templateDom_;
  },

  get bindingDescriptions() {
    if (this.bindingDescriptions_)
      return this.bindingDescriptions_;

    var ref = this.templateElement.ref;
    if (ref) {
      return this.bindingDescriptions_ =
          ref.templateIterator.bindingDescriptions;
    }

    createSnapshot(this);
    return this.bindingDescriptions_;
  },

  /**
   * Starts the iterator. At this point we
   */
  start: function() {
    if (!inDocument(this.templateElement))
      throw Error('Trying to start a template that is not in the document');

    // Setup bindingSource
    this.bindingSource = new BindingSource(undefined,  // source (default DOM)
                                           this.basePath,
                                           new IdentityTransform());
    this.bindingSource.bindTo(this.templateElement,
                              '',  // property (can safely be ignored)
                              this.boundHandleNewModel);
    // Begin observing model
    this.handleNewModel(this.bindingSource.pathValue.value);
  },

  handleNewModel: function(model, oldModel) {
    var iterate = this.templateElement.iterate != null;
    var instantiate = this.templateElement.instantiate != null;

    if (oldModel)
      Model.stopObservingObject(oldModel, this.boundHandleModelMutation);

    if (!iterate && !instantiate)
      this.rootModelChanged_(0);
    else if (isIterateTemplate(this))
      this.rootModelChanged_(model == null ? 0 : model.length);
    else if (oldModel === undefined || model === undefined)
      this.rootModelChanged_(model == undefined ? 0 : 1);

    if (model)
      Model.observeObject(model, this.boundHandleModelMutation);
  },

  rootModelChanged_: function(count) {
    this.clear();
    var templateElement = this.templateElement;
    var fullPath = Path.join(templateElement.templateScope_, this.basePath);

    for (var i = 0; i < count; i++) {
      var instance = new TemplateInstance(this,
                                          this.getInstancePath(fullPath, i));
      this.addInstance(instance);
    }

    this.syncDom_();
  },

  /**
   * The path on the template element. For instantiate template this reflects
   * the instantiate property of the template element and for iterate templates
   * this reflects the iterate property.
   * @type {string}
   */
  get basePath() {
    if (isIterateTemplate(this))
      return this.templateElement.iterate;
    return this.templateElement.instantiate;
  },

  /**
   * The path to use on an instance.
   * @param {string} base The computed path of the template.
   * @param {number} index The index of the instance. This is only used for
   *     iteration templates.
   */
  getInstancePath: function(base, index) {
    if (isIterateTemplate(this))
      return Path.join(base, index);
    return base;
  },

  /**
   * Removes the instance(s) that was created by this template.
   */
  clear: function() {
    var instance = this.firstInstance_;
    while (instance) {
      var current = instance;
      instance = instance.next;
      this.removeInstance(current);
    }
    this.firstInstance_ = null;
    this.lastInstance_ = null;
    this.syncDom_();
  },


  destruct: function() {
    this.clear();
    this.bindingSource.unbind();
    this.bindingSource = null;
  },

  /**
   * The last node that is managed by this iterator. This includes nodes that are
   * indirectly managed by this iterator due to nested templates.
   * @type {Node}
   */
  get lastManagedNode() {
    if (!this.lastInstance_)
      return this.templateElement;
    return this.lastInstance_.lastManagedNode;
  },

  addInstance: function(instance, beforeInstance) {
    // Update next/previous pointers.
    if (beforeInstance == null) {
      if (this.lastInstance_) {
        this.lastInstance_.next = instance;
        instance.previous = this.lastInstance_;
      }
      this.lastInstance_ = instance;

      if (!this.firstInstance_)
        this.firstInstance_ = instance;
    } else {
      if (beforeInstance.previous) {
        beforeInstance.previous.next = instance;
        instance.previous = beforeInstance.previous;
      }

      instance.next = beforeInstance;
      beforeInstance.previous = instance;

      if (beforeInstance == this.firstInstance_)
        this.firstInstance_ = instance;
    }
  },

  /**
   * Synchronizes the DOM of the instances.
   * @private
   */
  syncDom_: function() {
    for (var inst = this.firstInstance_; inst; inst = inst.next) {
      inst.syncDom();
    }

    this.instancesToRemove_.forEach(function(instance) {
      instance.syncDom();
    });
    this.instancesToRemove_ = [];
  },

  /**
   * Removes an instance. This marks the instance to be removed. The actual DOM
   * will get updated in the next call to syncDom.
   * @param {TemplateInstance} instance The instance to remove.
   */
  removeInstance: function(instance) {
    var previous = instance.previous;
    var next = instance.next;
    instance.remove();
    if (previous)
      previous.next = next;
    if (next)
      next.previous = previous;

    if (this.firstInstance_ == instance)
      this.firstInstance_ = next;
    if (this.lastInstance_ == instance)
      this.lastInstance_ = previous;

    this.instancesToRemove_.push(instance);
  },

  /**
   * @param {number} index The index where to get tne instance at.
   * @return {TemplateInstance} The instance at the given index or null if out
   *     bounds.
   */
  getInstanceAt: function(index) {
    var instance = this.firstInstance_;
    for (var i = 0; instance && i < index ; i++) {
      instance = instance.next;
    }

    return instance;
  },

  /**
   * Handles a mutation to the model. This only handles splice mutations.
   * @param {Object} c An object describing the change.
   */
  handleModelMutation: function(c) {
    if (c.mutation != 'splice' || !isIterateTemplate(this))
      return;

    // TODO(arv): Detect when an item was removed and added in the same splice.
    // For example, arr.splice(0, 2, arr[1], arr[0]), moves two elements and
    // we should just move the DOM nodes.

    var index = c.index;
    var addCount = c.added.length;
    var removeCount = c.removed.length;

    // iterate to index
    var instance = this.getInstanceAt(index);

    // Remove
    for (var i = 0; i < removeCount; i++) {
      var current = instance;
      instance = instance.next;
      this.removeInstance(current);
    }

    var templateElement = this.templateElement;
    var fullPath = Path.join(templateElement.templateScope_, this.basePath);

    // Add
    for (var i = 0; i < addCount; i++) {
      var newInstance = new TemplateInstance(this, Path.join(fullPath, index));
      index++;
      this.addInstance(newInstance, instance);
    }

    if (addCount != removeCount) {
      // Update the bindings for the remaining elements.
      for (; instance; instance = instance.next) {
        instance.templateScope = Path.join(fullPath, index);
        index++;
      }
    }

    this.syncDom_();
  }
};


/**
 * This represents a set of nodes that have been instantiated from a template
 * iterator.
 * @param {TemplateIterator} iterator The template iterator that owns this
 *     instance.
 * @param {string} templateScope The path from the parent of the template to the
 *     instance.
 * @constructor
 */
function TemplateInstance(iterator, templateScope) {
  this.templateIterator = iterator;
  this.templateScope_ = templateScope;
  this.nodes = [];

  var bindingDescriptions = iterator.bindingDescriptions;
  var parentNode = iterator.templateElement.parentNode;
  this.phantomBindings_ =
      createPhantomInstance(bindingDescriptions, parentNode, templateScope);
}

TemplateInstance.prototype = {
  next: null,
  previous: null,

  domCreated_: false,
  dirtyTemplateScope_: false,
  removed_: false,
  phantomBindings_: null,

  get firstNode() {
    return this.nodes[0];
  },

  get lastNode() {
    return this.nodes[this.nodes.length - 1];
  },

  /**
   * This returns the last node that is inside this instance or a template
   * owned by this instance.
   * @type {Node}
   */
  get lastManagedNode() {
    var node = this.lastNode;
    if (node.tagName == 'TEMPLATE') {
      var iterator = node.templateIterator_;
      if (iterator)
        return iterator.lastManagedNode;
    }

    return node;
  },

  /**
   * Creates the DOM for the instance.
   * @private
   */
  createDom_: function() {
    var iterator = this.templateIterator;
    var templateElement = iterator.templateElement;
    var parentNode = templateElement.parentNode;
    var templateDom = iterator.templateDom;
    var templateScope = this.templateScope_;
    var bindingDescriptions = iterator.bindingDescriptions;

    var refNode;
    if (!this.previous)
      refNode = templateElement.nextSibling;
    else
      refNode = this.previous.lastManagedNode.nextSibling;

    var clone = templateDom.cloneNode(true);

    // Cloning does not forward the template iterator so we do it manually.
    var orgTemplates = templateDom.querySelectorAll('template');
    var cloneTemplates = clone.querySelectorAll('template');

    for (var i = 0; i < orgTemplates.length; i++) {
      HTMLTemplateElement.decorate(cloneTemplates[i]);
      // Assign a new template iterator which is a clone of the original template
      // iterator.
      new TemplateIterator(cloneTemplates[i], orgTemplates[i].templateIterator);
    }

    function buildNestedTemplate(template) {
      template.templateIterator.start();
    }

    for (var i = 0; clone.hasChildNodes(); i++) {
      var node = clone.removeChild(clone.firstChild);
      parentNode.insertBefore(node, refNode);
      transferBindingsToNode(node, this.phantomBindings_[i], templateScope);
      this.nodes.push(node);
    }

    for (var i = 0; i < this.nodes.length; i++) {
      var node = this.nodes[i];
      // Also init newly created template elements.
      if (node.tagName == 'TEMPLATE') {
        buildNestedTemplate(node);
      } else if (node.nodeType == Node.ELEMENT_NODE) {
        var templates = node.querySelectorAll(':not(template) template');
        forEach(templates, buildNestedTemplate);
      }
    }

    // We don't need the phantom bindings any more.
    this.phantomBindings_ = null;

    this.dirtyTemplateScope_ = false;
    this.domCreated_ = true;
  },

  /**
   * Removes the instance from the DOM and removes the bindings.
   */
  remove: function() {
    this.next = null;
    this.previous = null;
    this.removed_ = true;
  },

  /**
   * Removes the actual DOM.
   * @private
   */
  removeDom_: function() {
    var parentNode = this.templateIterator.templateElement.parentNode;

    this.nodes.forEach(function(node) {
      destructTemplates(node);
      // Note: We need to remove the bindings before extracting from the
      // document, otherwise the BindingSources will re-parent to the root
      // nodes of the instance and fire.
      removeBindings(node);
      parentNode.removeChild(node);
      delete node.templateScope_;
    });
  },

  set templateScope(templateScope) {
    if (this.phantomBindings_) {
      for (var key in this.phantomBindings_) {
        this.phantomBindings_[key].templateScope_ = templateScope;
      }
    }

    this.templateScope_ = templateScope;
    this.dirtyTemplateScope_ = true;
  },

  /**
   * Synchronizes the DOM of the instance. This creates the DOM nodes if needed,
   * updates the templateScope if needed and removes the DOM as needed.
   */
  syncDom: function() {
    if (this.removed_) {
      this.removeDom_();
      return;
    }

    if (!this.domCreated_)
      this.createDom_();

    if (this.dirtyTemplateScope_)
      this.updateTemplateScope_();
  },

  /**
   * Updates the |templateScope_| on all the nodes.
   * @private
   */
  updateTemplateScope_: function() {
    var templateScope = this.templateScope_;
    this.nodes.forEach(function(node) {
      node.templateScope_ = templateScope;
    });
    this.dirtyTemplateScope_ = false;
  }
};

})();