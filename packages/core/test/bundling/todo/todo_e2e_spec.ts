/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ɵwhenRendered as whenRendered} from '@angular/core';
import {withBody} from '@angular/core/testing';
import * as fs from 'fs';
import * as path from 'path';

const UTF8 = {
  encoding: 'utf-8'
};
const PACKAGE = 'angular/packages/core/test/bundling/todo';
const BUNDLES = ['bundle.js', 'bundle.min_debug.js', 'bundle.min.js'];

describe('functional test for todo', () => {
  BUNDLES.forEach(bundle => {
    describe(bundle, () => {
      it('should render todo', withBody('<todo-app></todo-app>', async() => {
           require(path.join(PACKAGE, bundle));
           // TODO(misko): have cleaner way to do this for tests.
           const toDoAppComponent = (window as any).toDoAppComponent;
           expect(document.body.textContent).toContain('todos');
           expect(document.body.textContent).toContain('Demonstrate Components');
           expect(document.body.textContent).toContain('4 items left');
           document.querySelector('button') !.click();
           await whenRendered(toDoAppComponent);
           expect(document.body.textContent).toContain('3 items left');
         }));
    });
  });
});
