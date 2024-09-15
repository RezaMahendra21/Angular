/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import './ng_dev_mode';

import {assertNotNull} from './assert';
import {TNode, unusedValueExportToPlacateAjd as unused1} from './interfaces/node';
import {CssSelector, CssSelectorList, NG_PROJECT_AS_ATTR_NAME, SelectorFlags, unusedValueExportToPlacateAjd as unused2} from './interfaces/projection';

const unusedValueToPlacateAjd = unused1 + unused2;

function isCssClassMatching(nodeClassAttrVal: string, cssClassToMatch: string): boolean {
  const nodeClassesLen = nodeClassAttrVal.length;
  const matchIndex = nodeClassAttrVal !.indexOf(cssClassToMatch);
  const matchEndIdx = matchIndex + cssClassToMatch.length;
  if (matchIndex === -1                                                  // no match
      || (matchIndex > 0 && nodeClassAttrVal ![matchIndex - 1] !== ' ')  // no space before
      ||
      (matchEndIdx < nodeClassesLen && nodeClassAttrVal ![matchEndIdx] !== ' '))  // no space after
  {
    return false;
  }
  return true;
}

/**
 * A utility function to match an Ivy node static data against a simple CSS selector
 *
 * @param node static data to match
 * @param selector
 * @returns true if node matches the selector.
 */
export function isNodeMatchingSelector(tNode: TNode, selector: CssSelector): boolean {
  ngDevMode && assertNotNull(selector[0], 'Selector should have a tag name');

  let mode: SelectorFlags = SelectorFlags.ELEMENT;
  const nodeAttrs = tNode.attrs !;

  // When processing ":not" selectors, we skip to the next ":not" if the
  // current one doesn't match
  let skipToNextSelector = false;

  for (let i = 0; i < selector.length; i++) {
    const current = selector[i];
    if (typeof current === 'number') {
      // If we finish processing a :not selector and it hasn't failed, return false
      if (!skipToNextSelector && !isPositive(mode) && !isPositive(current as number)) {
        return false;
      }
      // If we are skipping to the next :not() and this mode flag is positive,
      // it's a part of the current :not() selector, and we should keep skipping
      if (skipToNextSelector && isPositive(current)) continue;
      skipToNextSelector = false;
      mode = (current as number) | (mode & SelectorFlags.NOT);
      continue;
    }

    if (skipToNextSelector) continue;

    if (mode & SelectorFlags.ELEMENT) {
      mode = SelectorFlags.ATTRIBUTE | mode & SelectorFlags.NOT;
      if (current !== '' && current !== tNode.tagName) {
        if (isPositive(mode)) return false;
        skipToNextSelector = true;
      }
    } else {
      const attrName = mode & SelectorFlags.CLASS ? 'class' : current;
      const attrIndexInNode = findAttrIndexInNode(attrName, nodeAttrs);

      if (attrIndexInNode === -1) {
        if (isPositive(mode)) return false;
        skipToNextSelector = true;
        continue;
      }

      const selectorAttrValue = mode & SelectorFlags.CLASS ? current : selector[++i];
      if (selectorAttrValue !== '') {
        const nodeAttrValue = nodeAttrs[attrIndexInNode + 1];
        if (mode & SelectorFlags.CLASS &&
                !isCssClassMatching(nodeAttrValue, selectorAttrValue as string) ||
            mode & SelectorFlags.ATTRIBUTE && selectorAttrValue !== nodeAttrValue) {
          if (isPositive(mode)) return false;
          skipToNextSelector = true;
        }
      }
    }
  }

  return isPositive(mode) || skipToNextSelector;
}

function isPositive(mode: SelectorFlags): boolean {
  return (mode & SelectorFlags.NOT) === 0;
}

function findAttrIndexInNode(name: string, attrs: string[] | null): number {
  if (attrs === null) return -1;
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return i;
  }
  return -1;
}

export function isNodeMatchingSelectorList(tNode: TNode, selector: CssSelectorList): boolean {
  for (let i = 0; i < selector.length; i++) {
    if (isNodeMatchingSelector(tNode, selector[i])) {
      return true;
    }
  }

  return false;
}

export function getProjectAsAttrValue(tNode: TNode): string|null {
  const nodeAttrs = tNode.attrs;
  if (nodeAttrs != null) {
    const ngProjectAsAttrIdx = nodeAttrs.indexOf(NG_PROJECT_AS_ATTR_NAME);
    // only check for ngProjectAs in attribute names, don't accidentally match attribute's value
    // (attribute names are stored at even indexes)
    if ((ngProjectAsAttrIdx & 1) === 0) {
      return nodeAttrs[ngProjectAsAttrIdx + 1];
    }
  }
  return null;
}

/**
 * Checks a given node against matching selectors and returns
 * selector index (or 0 if none matched).
 *
 * This function takes into account the ngProjectAs attribute: if present its value will be compared
 * to the raw (un-parsed) CSS selector instead of using standard selector matching logic.
 */
export function matchingSelectorIndex(
    tNode: TNode, selectors: CssSelectorList[], textSelectors: string[]): number {
  const ngProjectAsAttrVal = getProjectAsAttrValue(tNode);
  for (let i = 0; i < selectors.length; i++) {
    // if a node has the ngProjectAs attribute match it against unparsed selector
    // match a node against a parsed selector only if ngProjectAs attribute is not present
    if (ngProjectAsAttrVal === textSelectors[i] ||
        ngProjectAsAttrVal === null && isNodeMatchingSelectorList(tNode, selectors[i])) {
      return i + 1;  // first matching selector "captures" a given node
    }
  }
  return 0;
}
