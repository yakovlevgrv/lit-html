/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {render as baseRender, Template, templateCaches, TemplateResult} from '../lit-html.js';

export {html, svg, TemplateResult} from '../lit-html.js';

declare global {
  interface Window {
    ShadyCSS: any;
  }
}

/**
 * Template factory which scopes template DOM using ShadyCSS.
 * @param scopeName {string}
 */
const shadyTemplateFactory = (scopeName: string) =>
    (result: TemplateResult) => {
  const cacheKey = `${result.type}--${scopeName}`;
  let templateCache = templateCaches.get(cacheKey);
  if (templateCache === undefined) {
    templateCache = new Map<TemplateStringsArray, Template>();
    templateCaches.set(cacheKey, templateCache);
  }
  let template = templateCache.get(result.strings);
  if (template === undefined) {
    const element = result.getTemplateElement();
    if (typeof window.ShadyCSS === 'object') {
      window.ShadyCSS.prepareTemplateDom(element, scopeName);
    }
    template = new Template(result, element);
    templateCache.set(result.strings, template);
  }
  return template;
};

// 1. crawl template for styles and extract them, recursing into nested template results.
// 2. fix part indexes so parts stay in sync.
function extractStylesFromTemplate(styleTemplate: HTMLTemplateElement,
    templateFactory: Function, result: TemplateResult) {
  const {element: {content}, parts} = templateFactory(result);
  const walker = document.createTreeWalker(
    content,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT |
        NodeFilter.SHOW_TEXT,
    null as any,
    false);
  let partIndex = 0;
  let part = parts[partIndex];
  let partDelta = 0;
  let disableUntil = 0;
  let index = -1;
  const nodesToRemove: Node[] = [];
  while (walker.nextNode()) {
    index++;
    const node = walker.currentNode as Element;
    if (node.localName === 'style') {
      const removeCount = node.childNodes.length + 1;
      disableUntil = index + removeCount;
      partDelta -= removeCount;
      styleTemplate.content.appendChild(node.cloneNode(true));
      nodesToRemove.push(node);
    }
    if (part && part.index === index) {
      if (index < disableUntil) {
        part.index = -1;
      } else {
        part.index += partDelta;
      }
      const value = result.values[partIndex];
      extractStylesFromValue(styleTemplate, templateFactory, value);
      partIndex++;
      part = parts[partIndex];
    }
  }
  nodesToRemove.forEach((n) => n.parentNode!.removeChild(n));
}

// TODO(sorvell): brittle because value may be lots of things, e.g.
// should we support node values?
function extractStylesFromValue(styleTemplate: HTMLTemplateElement,
    templateFactory: Function, value: any) {
  if (value instanceof TemplateResult) {
    extractStylesFromTemplate(styleTemplate, templateFactory, value);
  } else if ((Array.isArray(value) || typeof value !== 'string' && value[Symbol.iterator])) {
    for (const item of value) {
      extractStylesFromValue(styleTemplate, templateFactory, item);
    }
  }
}

function insertStyleInTemplate(template: Template, style: HTMLStyleElement) {
  const {element: {content}} = template;
  content.insertBefore(style, content.firstChild);
  const adjustIndex = 1 + style.childNodes.length;
  template.parts.forEach((part) => {
    if (part.index >= 0) {
      part.index+= adjustIndex;
    }
  });
}

const shadyRenderSet = new Set<string>();

const needsStyleFixup = window.ShadyCSS && (!window.ShadyCSS.nativeShadow ||
  window.ShadyCSS.ApplyShim);

function hostForNode(node: Node) {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && (node as ShadowRoot).host
}

export function render(
    result: TemplateResult,
    container: Element|DocumentFragment,
    scopeName: string) {
  const host = hostForNode(container);
  if (needsStyleFixup && host) {
    const templateFactory = shadyTemplateFactory(scopeName);
    if (!shadyRenderSet.has(scopeName)) {
      shadyRenderSet.add(scopeName);
      const styleTemplate = document.createElement('template');
      extractStylesFromTemplate(styleTemplate, templateFactory, result);
      window.ShadyCSS.prepareTemplateStyles(styleTemplate, scopeName);
      // when using ApplyShim
      if (window.ShadyCSS.nativeShadow) {
        const style = styleTemplate.content.querySelector('style');
        if (style) {
          insertStyleInTemplate(templateFactory(result), style);
        }
      }
    }
    window.ShadyCSS.styleElement(host);
    return baseRender(result, container, templateFactory);
  } else {
    return baseRender(result, container);
  }
}
