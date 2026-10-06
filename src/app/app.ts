import {Component, REQUEST_CONTEXT, inject} from '@angular/core';
import {RouterOutlet} from '@angular/router';

@Component({selector: 'repro-app', imports: [RouterOutlet], template: '<router-outlet />'})
export class App {}

@Component({selector: 'rich-text-page', template: '<h1>Article</h1><article [innerHTML]="content"></article>'})
export class RichTextPage {
  readonly content = (inject(REQUEST_CONTEXT, {optional: true}) as {content?: string} | null)?.content ?? '';
}
