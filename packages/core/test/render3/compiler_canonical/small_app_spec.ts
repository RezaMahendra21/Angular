/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NgForOf, NgForOfContext} from '@angular/common';
import {Component, ContentChild, Directive, EventEmitter, Injectable, InjectableDef, InjectorDef, Input, NgModule, OnDestroy, Optional, Output, Pipe, PipeTransform, QueryList, SimpleChanges, TemplateRef, Type, ViewChild, ViewContainerRef, defineInjectable, defineInjector} from '@angular/core';
import {withBody} from '@angular/core/testing';

import * as r3 from '../../../src/render3/index';

/// See: `normative.md`



interface ToDo {
  text: string;
  done: boolean;
}

type $RenderFlags$ = r3.RenderFlags;

@Injectable()
class AppState {
  todos: ToDo[] = [
    {text: 'Demonstrate Components', done: false},
    {text: 'Demonstrate Structural Directives', done: false},
    {text: 'Demonstrate NgModules', done: false},
    {text: 'Demonstrate zoneless changed detection', done: false},
    {text: 'Demonstrate internationalization', done: false},
  ];

  // NORMATIVE
  static ngInjectableDef = defineInjectable({factory: () => new AppState()});
  // /NORMATIVE
}

@Component({
  selector: 'todo-app',
  template: `
  <h1>ToDo Application</h1>
  <div>
    <todo *ngFor="let todo of appState.todos" [todo]="todo" (archive)="onArchive($event)"></todo>
  </div>
  <span>count: {{appState.todos.length}}.</span>
  `
})
class ToDoAppComponent {
  constructor(public appState: AppState) {}

  onArchive(item: ToDo) {
    const todos = this.appState.todos;
    todos.splice(todos.indexOf(item));
    r3.markDirty(this);
  }

  // NORMATIVE
  static ngComponentDef = r3.defineComponent({
    type: ToDoAppComponent,
    selectors: [['todo-app']],
    factory: function ToDoAppComponent_Factory() {
      return new ToDoAppComponent(r3.directiveInject(AppState));
    },
    template: function ToDoAppComponent_Template(rf: $RenderFlags$, ctx: ToDoAppComponent) {
      if (rf & 1) {
        const ToDoAppComponent_NgForOf_Template = function ToDoAppComponent_NgForOf_Template(
            rf: $RenderFlags$, ctx1: NgForOfContext<ToDo>) {
          if (rf & 1) {
            r3.E(0, 'todo');
            r3.L('archive', ctx.onArchive.bind(ctx));
            r3.e();
          }
          if (rf & 2) {
            r3.p(0, 'todo', r3.b(ctx1.$implicit));
          }
        };
        r3.E(0, 'h1');
        r3.T(1, 'ToDo Application');
        r3.e();
        r3.E(2, 'div');
        r3.C(3, ToDoAppComponent_NgForOf_Template, '', ['ngForOf', '']);
        r3.e();
        r3.E(4, 'span');
        r3.T(5);
        r3.e();
      }
      if (rf & 2) {
        r3.t(5, r3.i1('count: ', ctx.appState.todos.length, ''));
      }
    }
  });
  // /NORMATIVE
}

// NON-NORMATIVE
ToDoAppComponent.ngComponentDef.directiveDefs = () =>
    [ToDoItemComponent.ngComponentDef, (NgForOf as r3.DirectiveType<NgForOf<any>>).ngDirectiveDef];
// /NON-NORMATIVE

@Component({
  selector: 'todo',
  template: `
    <div [class.done]="todo.done">
      <input type="checkbox" [value]="todo.done" (click)="onCheckboxClick()"></input>
      <span>{{todo.text}}</span>
      <button (click)="onArchiveClick()">archive</button>
    </div>
  `
})
class ToDoItemComponent {
  static DEFAULT_TODO: ToDo = {text: '', done: false};

  @Input()
  todo: ToDo = ToDoItemComponent.DEFAULT_TODO;

  @Output()
  archive = new EventEmitter();

  onCheckboxClick() {
    this.todo.done = !this.todo.done;
    r3.markDirty(this);
  }

  onArchiveClick() { this.archive.emit(this.todo); }

  // NORMATIVE
  static ngComponentDef = r3.defineComponent({
    type: ToDoItemComponent,
    selectors: [['todo']],
    factory: function ToDoItemComponent_Factory() { return new ToDoItemComponent(); },
    template: function ToDoItemComponent_Template(rf: $RenderFlags$, ctx: ToDoItemComponent) {
      if (rf & 1) {
        r3.E(0, 'div');
        r3.E(1, 'input', e1_attrs);
        r3.L('click', ctx.onCheckboxClick.bind(ctx));
        r3.e();
        r3.E(2, 'span');
        r3.T(3);
        r3.e();
        r3.E(4, 'button');
        r3.L('click', ctx.onArchiveClick.bind(ctx));
        r3.T(5, 'archive');
        r3.e();
        r3.e();
      }
      if (rf & 2) {
        r3.p(1, 'value', r3.b(ctx.todo.done));
        r3.t(3, r3.b(ctx.todo.text));
      }
    },
    inputs: {todo: 'todo'},
  });
  // /NORMATIVE
}
// NORMATIVE
const e1_attrs = ['type', 'checkbox'];
// /NORMATIVE


@NgModule({
  declarations: [ToDoAppComponent, ToDoItemComponent],
  providers: [AppState],
})
class ToDoAppModule {
  // NORMATIVE
  static ngInjectorDef = defineInjector({
    factory: () => new ToDoAppModule(),
    providers: [AppState],
  });
  // /NORMATIVE
}


describe('small_app', () => {
  xit('should render',
      () => withBody('<todo-app></todo-app>', async() => {
        // TODO: Implement this method once all of the pieces of this application can execute.
        // TODO: add i18n example by translating to french.
        const todoApp = r3.renderComponent(ToDoAppComponent);
        await r3.whenRendered(todoApp);
        expect(r3.getRenderedText(todoApp)).toEqual('...');
        const firstCheckBox =
            r3.getHostElement(todoApp).querySelector('input[type=checkbox]') as HTMLElement;
        firstCheckBox.click();
        await r3.whenRendered(todoApp);
        expect(r3.getRenderedText(todoApp)).toEqual('...');
        const firstArchive = r3.getHostElement(todoApp).querySelector('button') as HTMLElement;
        firstArchive.click;
        await r3.whenRendered(todoApp);
        expect(r3.getRenderedText(todoApp)).toEqual('...');
      }));
});
