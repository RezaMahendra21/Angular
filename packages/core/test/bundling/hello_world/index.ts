/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Component, NgModule, ɵrenderComponent as renderComponent} from '@angular/core';

@Component({selector: 'hello-world', template: 'Hello World!'})
export class HelloWorld {
}
// TODO(misko): Forgetting to export HelloWorld and not having NgModule fails silently.

@NgModule({declarations: [HelloWorld]})
export class INeedToExistEvenThoughIAmNotNeeded {
}
// TODO(misko): Package should not be required to make this work.

renderComponent(HelloWorld);
