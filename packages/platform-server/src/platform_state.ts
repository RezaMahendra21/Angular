/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Inject, Injectable} from '@angular/core';
import {DOCUMENT, ɵgetDOM as getDOM} from '@angular/platform-browser';

import {serializeDocument} from './domino_adapter';

/**
 * Representation of the current platform state.
 *
 * @experimental
 */
@Injectable()
export class PlatformState {
  constructor(@Inject(DOCUMENT) private _doc: any) {}

  /**
   * Renders the current state of the platform to string.
   */
  renderToString(): string { return serializeDocument(this._doc); }

  /**
   * Returns the current DOM state.
   */
  getDocument(): any { return this._doc; }
}
