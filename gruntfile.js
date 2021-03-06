// Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
// This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
// The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
// The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
// Code distributed by Google as part of the polymer project is also
// subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt

module.exports = function(grunt) {

  grunt.initConfig({
    karma: {
      options: {
        configFile: 'conf/karma.conf.js',
        keepalive: true
      },
      buildbot: {
        reporters: ['crbot'],
        logLevel: 'OFF'
      },
      TemplateBinding: {
      }
    },
    concat: {
      modules: {
        src: grunt.file.readJSON('build.json'),
        dest: 'TemplateBinding.js',
        nonull: true
      }
    },
    uglify: {
      options: {},
      TemplateBinding: {
        files: {
          'TemplateBinding.min.js': ['TemplateBinding.js']
        }
      }
    }
  });

  grunt.loadTasks('../tools/tasks');
  grunt.loadNpmTasks('grunt-karma');
  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-uglify');

  grunt.registerTask('default', 'concat');
  grunt.registerTask('default', 'uglify');
  grunt.registerTask('test', ['override-chrome-launcher', 'karma:TemplateBinding']);
  grunt.registerTask('test-buildbot', ['override-chrome-launcher', 'karma:buildbot']);
};
