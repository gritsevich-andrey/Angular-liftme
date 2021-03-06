/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {AttributeMarker} from '@angular/compiler/src/core';
import {setup} from '@angular/compiler/test/aot/test_util';
import * as ts from 'typescript';

import {DEFAULT_INTERPOLATION_CONFIG, InterpolationConfig} from '../../../compiler/src/compiler';
import {decimalDigest} from '../../../compiler/src/i18n/digest';
import {extractMessages} from '../../../compiler/src/i18n/extractor_merger';
import {HtmlParser} from '../../../compiler/src/ml_parser/html_parser';

import {compile, expectEmit} from './mock_compile';

const angularFiles = setup({
  compileAngular: false,
  compileFakeCore: true,
  compileAnimations: false,
});

const htmlParser = new HtmlParser();

// TODO: update translation extraction RegExp to support `$localize` tags.
const EXTRACT_GENERATED_TRANSLATIONS_REGEXP =
    /const\s*(.*?)\s*=\s*goog\.getMsg\("(.*?)",?\s*(.*?)\)/g;

const diff = (a: Set<string>, b: Set<string>): Set<string> =>
    new Set([...Array.from(a)].filter(x => !b.has(x)));

const extract = (from: string, regex: any, transformFn: (match: any[], state: Set<any>) => any) => {
  const result = new Set<any>();
  let item;
  while ((item = regex.exec(from)) !== null) {
    result.add(transformFn(item, result));
  }
  return result;
};

// verify that we extracted all the necessary translations
// and their ids match the ones extracted via 'ng xi18n'
const verifyTranslationIds =
    (source: string, output: string, exceptions = {},
     interpolationConfig: InterpolationConfig = DEFAULT_INTERPOLATION_CONFIG) => {
      const parseResult =
          htmlParser.parse(source, 'path:://to/template', {tokenizeExpansionForms: true});
      const extractedIdToMsg = new Map<string, any>();
      const extractedIds = new Set<string>();
      const generatedIds = new Set<string>();
      const msgs = extractMessages(parseResult.rootNodes, interpolationConfig, [], {});
      msgs.messages.forEach(msg => {
        const id = msg.id || decimalDigest(msg);
        extractedIds.add(id);
        extractedIdToMsg.set(id, msg);
      });
      const regexp = /const\s*MSG_EXTERNAL_(.+?)\s*=\s*goog\.getMsg/g;
      const ids = extract(output, regexp, v => v[1]);
      ids.forEach(id => {
        generatedIds.add(id.split('$$')[0]);
      });
      const delta = diff(extractedIds, generatedIds);
      if (delta.size) {
        // check if we have ids in exception list
        const outstanding = diff(delta, new Set(Object.keys(exceptions)));
        if (outstanding.size) {
          throw new Error(`
        Extracted and generated IDs don't match, delta:
        ${JSON.stringify(Array.from(delta))}
      `);
        }
      }
      return true;
    };

// verify that placeholders in translation string match
// placeholders object defined as goog.getMsg function argument
const verifyPlaceholdersIntegrity = (output: string) => {
  const extractTranslations = (from: string) => {
    return extract(from, EXTRACT_GENERATED_TRANSLATIONS_REGEXP, v => [v[2], v[3]]);
  };
  const extractPlaceholdersFromBody = (body: string) => {
    const regex = /{\$(.*?)}/g;
    return extract(body, regex, v => v[1]);
  };
  const extractPlaceholdersFromArgs = (args: string) => {
    const regex = /\s+"(.+?)":\s*".*?"/g;
    return extract(args, regex, v => v[1]);
  };
  const translations = extractTranslations(output);
  translations.forEach((translation) => {
    const bodyPhs = extractPlaceholdersFromBody(translation[0]);
    const argsPhs = extractPlaceholdersFromArgs(translation[1]);
    if (bodyPhs.size !== argsPhs.size || diff(bodyPhs, argsPhs).size) {
      return false;
    }
  });
  return true;
};

const verifyUniqueConsts = (output: string) => {
  extract(
      output, EXTRACT_GENERATED_TRANSLATIONS_REGEXP,
      (current: string[], state: Set<any>): string => {
        const key = current[1];
        if (state.has(key)) {
          throw new Error(`Duplicate const ${key} found in generated output!`);
        }
        return key;
      });
  return true;
};

/**
 * Escape the template string for being placed inside a backtick string literal.
 *
 * * "\" would erroneously indicate a control character
 * * "`" and "${" strings would erroneously indicate the end of a message part
 */
const escapeTemplate = (template: string) =>
    template.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '$\\{');

const getAppFilesWithTemplate = (template: string, args: any = {}) => ({
  app: {
    'spec.template.html': template,
    'spec.ts': `
      import {Component, NgModule} from '@angular/core';

      @Component({
        selector: 'my-component',
        ${args.preserveWhitespaces ? 'preserveWhitespaces: true,' : ''}
        ${args.interpolation ? 'interpolation: ' + JSON.stringify(args.interpolation) + ', ' : ''}
        ${
        args.templateUrl ? `templateUrl: 'spec.template.html'` :
                           `template: \`${escapeTemplate(template)}\``})
      export class MyComponent {}

      @NgModule({declarations: [MyComponent]})
      export class MyModule {}
    `
  }
});

const maybePrint = (output: string, verbose: boolean) => {
  if (!verbose) return;
  // tslint:disable-next-line
  console.log(`
========== Generated output: ==========
${output}
=======================================
  `);
};

const verify = (input: string, output: string, extra: any = {}): void => {
  const files = getAppFilesWithTemplate(input, extra.inputArgs);
  const opts = (i18nUseExternalIds: boolean) =>
      ({i18nUseExternalIds, ...(extra.compilerOptions || {})});

  // invoke with file-based prefix translation names
  if (!extra.skipPathBasedCheck) {
    const result = compile(files, angularFiles, opts(false));
    maybePrint(result.source, extra.verbose);
    expect(verifyPlaceholdersIntegrity(result.source)).toBe(true);
    expect(verifyUniqueConsts(result.source)).toBe(true);
    expectEmit(result.source, output, 'Incorrect template');
  }

  // invoke with translation names based on external ids
  if (!extra.skipIdBasedCheck) {
    const result = compile(files, angularFiles, opts(true));
    maybePrint(result.source, extra.verbose);
    const interpolationConfig = extra.inputArgs && extra.inputArgs.interpolation ?
        InterpolationConfig.fromArray(extra.inputArgs.interpolation) :
        undefined;
    expect(verifyTranslationIds(input, result.source, extra.exceptions, interpolationConfig))
        .toBe(true);
    expect(verifyPlaceholdersIntegrity(result.source)).toBe(true);
    expect(verifyUniqueConsts(result.source)).toBe(true);
    expectEmit(result.source, output, 'Incorrect template');
  }
};

// Describes message metadata object.
interface Meta {
  desc?: string;
  meaning?: string;
  id?: string;
}

// Describes placeholder type used in tests. Note: the type is an array (not an object), since it's
// important to preserve the order of placeholders (so that we can compare it with generated
// output).
type Placeholder = [string, string];

// Unique message id index that is needed to avoid different i18n vars with the same name to appear
// in the i18n block while generating an output string (used to verify compiler-generated code).
let msgIndex = 0;

// Wraps a string into quotes is needed.
// Note: if a string starts with `$` is a special case in tests when ICU reference
// is used as a placeholder value, this we should not wrap it in quotes.
const quotedValue = (value: string) => value.startsWith('$') ? value : `"${value}"`;

// Generates a string that represents expected Closure metadata output.
const i18nMsgClosureMeta = (meta?: Meta): string => {
  if (!meta || !(meta.desc || meta.meaning)) return '';
  return `
    /**
     ${meta.desc ? '* @desc ' + meta.desc : ''}
     ${meta.meaning ? '* @meaning ' + meta.meaning : ''}
     */
  `;
};

// Converts a set of placeholders to a string (as it's expected from compiler).
const i18nPlaceholdersToString = (placeholders: Placeholder[]): string => {
  if (placeholders.length === 0) return '';
  const result = placeholders.map(([key, value]) => `"${key}": ${quotedValue(value)}`);
  return `, { ${result.join(',')} }`;
};

// Generates a string that represents expected $localize metadata output.
const i18nMsgLocalizeMeta = (meta?: Meta): string => {
  if (!meta) return '';
  let localizeMeta = '';
  if (meta.meaning) localizeMeta += `${meta.meaning}|`;
  if (meta.desc) localizeMeta += meta.desc;
  if (meta.id) localizeMeta += `@@${meta.id}`;
  return `:${localizeMeta}:`;
};

// Transforms a message in a Closure format to a $localize version.
const i18nMsgInsertLocalizePlaceholders =
    (message: string, placeholders: Placeholder[]): string => {
      if (placeholders.length > 0) {
        message = message.replace(/{\$(.*?)}/g, function(_, name) {
          const value = placeholders.find(([k, _]) => k === name)![1];
          // e.g. startDivTag -> START_DIV_TAG
          const key = name.replace(/[A-Z]/g, (ch: string) => '_' + ch).toUpperCase();
          return '$' + String.raw`{${quotedValue(value)}}:${key}:`;
        });
      }
      return message;
    };

// Generates a string that represents expected i18n block content for simple message.
const i18nMsg = (message: string, placeholders: Placeholder[] = [], meta?: Meta) => {
  const varName = `$I18N_${msgIndex++}$`;
  const closurePlaceholders = i18nPlaceholdersToString(placeholders);
  const locMessageWithPlaceholders = i18nMsgInsertLocalizePlaceholders(message, placeholders);
  return String.raw`
    let ${varName};
    if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
        ${i18nMsgClosureMeta(meta)}
        const $MSG_EXTERNAL_${msgIndex}$ = goog.getMsg("${message}"${closurePlaceholders});
        ${varName} = $MSG_EXTERNAL_${msgIndex}$;
    }
    else {
      ${varName} = $localize \`${i18nMsgLocalizeMeta(meta)}${locMessageWithPlaceholders}\`;
    }`;
};

// Generates a string that represents expected i18n block content for a message that requires
// post-processing (thus includes `????i18nPostprocess` in generated code).
const i18nMsgWithPostprocess =
    (message: string, placeholders: Placeholder[] = [], meta?: Meta,
     postprocessPlaceholders?: Placeholder[]) => {
      const varName = `$I18N_${msgIndex}$`;
      const ppPaceholders =
          postprocessPlaceholders ? i18nPlaceholdersToString(postprocessPlaceholders) : '';
      return String.raw`
        ${i18nMsg(message, placeholders, meta)}
        ${varName} = $r3$.????i18nPostprocess($${varName}$${ppPaceholders});
      `;
    };

// Generates a string that represents expected i18n block content for an ICU.
const i18nIcuMsg = (message: string, placeholders: Placeholder[] = []) => {
  return i18nMsgWithPostprocess(message, [], undefined, placeholders);
};

describe('i18n support in the template compiler', () => {
  describe('element attributes', () => {
    it('should add the meaning and description as JsDoc comments and metadata blocks', () => {
      const input = `
        <div i18n="meaningA|descA@@idA">Content A</div>
        <div i18n-title="meaningB|descB@@idB" title="Title B">Content B</div>
        <div i18n-title="meaningC|" title="Title C">Content C</div>
        <div i18n-title="meaningD|descD" title="Title D">Content D</div>
        <div i18n-title="meaningE@@idE" title="Title E">Content E</div>
        <div i18n-title="@@idF" title="Title F">Content F</div>
        <div i18n-title="[BACKUP_$\{MESSAGE}_ID:idH]\`desc@@idG" title="Title G">Content G</div>
        <div i18n="Some text \\' [BACKUP_MESSAGE_ID: xxx]">Content H</div>
      `;

      const i18n_0 = i18nMsg('Content A', [], {id: 'idA', meaning: 'meaningA', desc: 'descA'});
      const i18n_1 = i18nMsg('Title B', [], {id: 'idB', meaning: 'meaningB', desc: 'descB'});
      const i18n_2 = i18nMsg('Title C', [], {meaning: 'meaningC'});
      const i18n_3 = i18nMsg('Title D', [], {meaning: 'meaningD', desc: 'descD'});
      const i18n_4 = i18nMsg('Title E', [], {id: 'idE', desc: 'meaningE'});
      const i18n_5 = i18nMsg('Title F', [], {id: 'idF'});

      // Keeping this block as a raw string, since it checks escaping of special chars.
      const i18n_6 = String.raw`
        let $i18n_23$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
          /**
           * @desc [BACKUP_$` +
          String.raw`{MESSAGE}_ID:idH]` +
          '`' + String.raw`desc
           */
          const $MSG_EXTERNAL_idG$$APP_SPEC_TS_24$ = goog.getMsg("Title G");
          $i18n_23$ = $MSG_EXTERNAL_idG$$APP_SPEC_TS_24$;
        }
        else {
          $i18n_23$ = $localize \`:[BACKUP_$\{MESSAGE}_ID\:idH]\\\`desc@@idG:Title G\`;
        }
      `;

      // Keeping this block as a raw string, since it checks escaping of special chars.
      const i18n_7 = String.raw`
        let $i18n_7$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
          /**
           * @desc Some text \' [BACKUP_MESSAGE_ID: xxx]
           */
          const $MSG_EXTERNAL_idG$$APP_SPEC_TS_21$ = goog.getMsg("Content H");
          $i18n_7$ = $MSG_EXTERNAL_idG$$APP_SPEC_TS_21$;
        }
        else {
          $i18n_7$ = $localize \`:Some text \\' [BACKUP_MESSAGE_ID\: xxx]:Content H\`;
        }
      `;

      const output = String.raw`
        consts: function () {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          ${i18n_3}
          ${i18n_4}
          ${i18n_5}
          ${i18n_6}
          ${i18n_7}
          return [
            $i18n_0$,
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_1$],
            ["title", $i18n_2$],
            ["title", $i18n_3$],
            ["title", $i18n_4$],
            ["title", $i18n_5$],
            ["title", $i18n_6$],
            $i18n_7$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
            $r3$.????elementStart(2, "div", 1);
            $r3$.????i18nAttributes(3, 2);
            $r3$.????text(4, "Content B");
            $r3$.????elementEnd();
            $r3$.????elementStart(5, "div", 1);
            $r3$.????i18nAttributes(6, 3);
            $r3$.????text(7, "Content C");
            $r3$.????elementEnd();
            $r3$.????elementStart(8, "div", 1);
            $r3$.????i18nAttributes(9, 4);
            $r3$.????text(10, "Content D");
            $r3$.????elementEnd();
            $r3$.????elementStart(11, "div", 1);
            $r3$.????i18nAttributes(12, 5);
            $r3$.????text(13, "Content E");
            $r3$.????elementEnd();
            $r3$.????elementStart(14, "div", 1);
            $r3$.????i18nAttributes(15, 6);
            $r3$.????text(16, "Content F");
            $r3$.????elementEnd();
            $r3$.????elementStart(17, "div", 1);
            $r3$.????i18nAttributes(18, 7);
            $r3$.????text(19, "Content G");
            $r3$.????elementEnd();
            $r3$.????elementStart(20, "div");
            $r3$.????i18n(21, 8);
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should support i18n attributes on explicit <ng-template> elements', () => {
      const input = `
        <ng-template i18n-title title="Hello"></ng-template>
      `;

      const i18n_0 = i18nMsg('Hello');
      const output = String.raw`
        consts: function () {
          ${i18n_0}
          return [
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_ng_template_0_Template, 0, 0, "ng-template", 0);
            $r3$.????i18nAttributes(1, 1);
          }
        }
      `;
      verify(input, output);
    });

    it('should support i18n attributes on explicit <ng-template> with structural directives',
       () => {
         const input = `
            <ng-template *ngIf="visible" i18n-title title="Hello">Test</ng-template>
          `;

         const i18n_0 = i18nMsg('Hello');

         const output = String.raw`
            function MyComponent_0_ng_template_0_Template(rf, ctx) {
              if (rf & 1) {
                $r3$.????text(0, "Test");
              }
            }
            function MyComponent_0_Template(rf, ctx) {
              if (rf & 1) {
                $r3$.????template(0, MyComponent_0_ng_template_0_Template, 1, 0, "ng-template", 1);
                $r3$.????i18nAttributes(1, 2);
              }
            }
            ???
            consts: function() {
              ${i18n_0}
              return [
                [${AttributeMarker.Template}, "ngIf"],
                [${AttributeMarker.I18n}, "title"],
                ["title", $i18n_0$]
              ];
            },
            template: function MyComponent_Template(rf, ctx) {
              if (rf & 1) {
                $r3$.????template(0, MyComponent_0_Template, 2, 0, undefined, 0);
              }
              if (rf & 2) {
                $r3$.????property("ngIf", ctx.visible);
              }
            }
          `;
         verify(input, output);
       });

    it('should support i18n attributes with interpolations on explicit <ng-template> elements',
       () => {
         const input = `
           <ng-template i18n-title title="Hello {{ name }}"></ng-template>
         `;

         const i18n_0 =
             i18nMsg('Hello {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);
         const output = String.raw`
           consts: function() {
             ${i18n_0}
             return [
               [${AttributeMarker.Bindings}, "title"],
               ["title", $i18n_0$]
             ];
           },
           template: function MyComponent_Template(rf, ctx) {
             if (rf & 1) {
               $r3$.????template(0, MyComponent_ng_template_0_Template, 0, 0, "ng-template", 0);
               $r3$.????i18nAttributes(1, 1);
             }
             if (rf & 2) {
               $r3$.????i18nExp(ctx.name);
               $r3$.????i18nApply(1);
             }
           }
         `;
         verify(input, output);
       });

    it('should support i18n attributes with interpolations on explicit <ng-template> elements with structural directives',
       () => {
         const input = `
            <ng-template *ngIf="true" i18n-title title="Hello {{ name }}"></ng-template>
          `;

         const i18n_0 =
             i18nMsg('Hello {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);
         const output = String.raw`
            function MyComponent_0_Template(rf, ctx) {
              if (rf & 1) {
                $r3$.????template(0, MyComponent_0_ng_template_0_Template, 0, 0, "ng-template", 1);
                $r3$.????i18nAttributes(1, 2);
              }
              if (rf & 2) {
                const $ctx_r2$ = $r3$.????nextContext();
                $r3$.????i18nExp($ctx_r2$.name);
                $r3$.????i18nApply(1);
              }
            }
            ???
            consts: function() {
              ${i18n_0}
              return [
                [${AttributeMarker.Template}, "ngIf"],
                [${AttributeMarker.Bindings}, "title"],
                ["title", $i18n_0$]
              ];
            },
            template: function MyComponent_Template(rf, ctx) {
              if (rf & 1) {
                $r3$.????template(0, MyComponent_0_Template, 2, 1, undefined, 0);
              }
              if (rf & 2) {
                $r3$.????property("ngIf", true);
              }
            },
          `;
         verify(input, output);
       });

    it('should not create translations for empty attributes', () => {
      const input = `
        <div id="static" i18n-title="m|d" title></div>
      `;

      const output = `
        ???
        consts: [["id", "static", "title", ""]],
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????element(0, "div", 0);
          }
        }
      `;

      verify(input, output);
    });

    it('should not create translations for bound attributes', () => {
      const input = `
        <div
          [title]="title" i18n-title
          [attr.label]="label" i18n-attr.label>
        </div>
      `;

      const output = `
        consts: [[3, "title"]],
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????element(0, "div", 0);
          }
          if (rf & 2) {
            $r3$.????property("title", ctx.title);
            $r3$.????attribute("label", ctx.label);
          }
        }
      `;

      verify(input, output);
    });

    it('should translate static attributes', () => {
      const input = `
        <div id="static" i18n-title="m|d" title="introduction"></div>
      `;

      const i18n_0 = i18nMsg('introduction', [], {meaning: 'm', desc: 'd'});

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            ["id", "static", ${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????i18nAttributes(1, 1);
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should support interpolation', () => {
      const input = `
        <div id="dynamic-1"
          i18n-title="m|d" title="intro {{ valueA | uppercase }}"
          i18n-aria-label="m1|d1" aria-label="{{ valueB }}"
          i18n-aria-roledescription aria-roledescription="static text"
        ></div>
        <div id="dynamic-2"
          i18n-title="m2|d2" title="{{ valueA }} and {{ valueB }} and again {{ valueA + valueB }}"
          i18n-aria-roledescription aria-roledescription="{{ valueC }}"
        ></div>
      `;

      const i18n_0 = i18nMsg('static text');
      const i18n_1 = i18nMsg(
          'intro {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm', desc: 'd'});
      const i18n_2 = i18nMsg(
          '{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm1', desc: 'd1'});
      const i18n_3 = i18nMsg(
          '{$interpolation} and {$interpolation_1} and again {$interpolation_2}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['interpolation_1', String.raw`\uFFFD1\uFFFD`],
            ['interpolation_2', String.raw`\uFFFD2\uFFFD`]
          ],
          {meaning: 'm2', desc: 'd2'});
      const i18n_4 = i18nMsg('{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 5,
        vars: 8,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          ${i18n_3}
          ${i18n_4}
          return [
            ["id", "dynamic-1", ${AttributeMarker.I18n}, "aria-roledescription",
                                                                "title", "aria-label"],
            ["aria-roledescription", $i18n_0$, "title", $i18n_1$, "aria-label", $i18n_2$],
            ["id", "dynamic-2", ${AttributeMarker.I18n}, "title", "aria-roledescription"],
            ["title", $i18n_3$, "aria-roledescription", $i18n_4$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????pipe(1, "uppercase");
            $r3$.????i18nAttributes(2, 1);
            $r3$.????elementEnd();
            $r3$.????elementStart(3, "div", 2);
            $r3$.????i18nAttributes(4, 3);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????i18nExp($r3$.????pipeBind1(1, 6, ctx.valueA))(ctx.valueB);
            $r3$.????i18nApply(2);
            $r3$.????advance(3);
            $r3$.????i18nExp(ctx.valueA)(ctx.valueB)(ctx.valueA + ctx.valueB)(ctx.valueC);
            $r3$.????i18nApply(4);
          }
        }
      `;

      verify(input, output);
    });

    it('should support interpolation with custom interpolation config', () => {
      const input = `
        <div i18n-title="m|d" title="intro {% valueA | uppercase %}"></div>
      `;

      const i18n_0 = i18nMsg(
          'intro {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm', desc: 'd'});

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????pipe(1, "uppercase");
            $r3$.????i18nAttributes(2, 1);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????i18nExp($r3$.????pipeBind1(1, 1, ctx.valueA));
            $r3$.????i18nApply(2);
          }
        }
      `;
      verify(input, output, {inputArgs: {interpolation: ['{%', '%}']}});
    });

    it('should correctly bind to context in nested template', () => {
      const input = `
        <div *ngFor="let outer of items">
          <div i18n-title="m|d" title="different scope {{ outer | uppercase }}"></div>
        </div>
      `;

      const i18n_0 = i18nMsg(
          'different scope {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm', desc: 'd'});

      const output = String.raw`
        function MyComponent_div_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????elementStart(1, "div", 1);
            $r3$.????pipe(2, "uppercase");
            $r3$.????i18nAttributes(3, 2);
            $r3$.????elementEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            const $outer_r1$ = ctx.$implicit;
            $r3$.????advance(1);
            $r3$.????i18nExp($r3$.????pipeBind1(2, 1, $outer_r1$));
            $r3$.????i18nApply(3);
          }
        }
        ???
        decls: 1,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.Template}, "ngFor", "ngForOf"],
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_div_0_Template, 4, 3, "div", 0);
          }
          if (rf & 2) {
            $r3$.????property("ngForOf", ctx.items);
          }
        }
      `;

      verify(input, output);
    });

    it('should support complex expressions in interpolation', () => {
      const input = `
        <div i18n-title title="{{valueA.getRawValue()?.getTitle()}} title"></div>
      `;

      const i18n_0 =
          i18nMsg('{$interpolation} title', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 2,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????i18nAttributes(1, 1);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
              let $tmp_0_0$ = null;
              $r3$.????i18nExp(($tmp_0_0$ = ctx.valueA.getRawValue()) == null ? null : $tmp_0_0$.getTitle());
              $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should support interpolation', () => {
      const input = `
        <div id="dynamic-1"
          i18n-title="m|d" title="intro {{ valueA | uppercase }}"
          i18n-aria-label="m1|d1" aria-label="{{ valueB }}"
          i18n-aria-roledescription aria-roledescription="static text"
        ></div>
        <div id="dynamic-2"
          i18n-title="m2|d2" title="{{ valueA }} and {{ valueB }} and again {{ valueA + valueB }}"
          i18n-aria-roledescription aria-roledescription="{{ valueC }}"
        ></div>
      `;

      const i18n_0 = i18nMsg('static text');
      const i18n_1 = i18nMsg(
          'intro {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm', desc: 'd'});
      const i18n_2 = i18nMsg(
          '{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm1', desc: 'd1'});
      const i18n_3 = i18nMsg(
          '{$interpolation} and {$interpolation_1} and again {$interpolation_2}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['interpolation_1', String.raw`\uFFFD1\uFFFD`],
            ['interpolation_2', String.raw`\uFFFD2\uFFFD`]
          ],
          {meaning: 'm2', desc: 'd2'});
      const i18n_4 = i18nMsg('{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 5,
        vars: 8,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          ${i18n_3}
          ${i18n_4}
          return [
            ["id", "dynamic-1", ${AttributeMarker.I18n}, "aria-roledescription",
                                                                "title", "aria-label"],
            ["aria-roledescription", $i18n_0$, "title", $i18n_1$, "aria-label", $i18n_2$],
            ["id", "dynamic-2", ${AttributeMarker.I18n}, "title", "aria-roledescription"],
            ["title", $i18n_3$, "aria-roledescription", $i18n_4$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????pipe(1, "uppercase");
            $r3$.????i18nAttributes(2, 1);
            $r3$.????elementEnd();
            $r3$.????elementStart(3, "div", 2);
            $r3$.????i18nAttributes(4, 3);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????i18nExp($r3$.????pipeBind1(1, 6, ctx.valueA))(ctx.valueB);
            $r3$.????i18nApply(2);
            $r3$.????advance(3);
            $r3$.????i18nExp(ctx.valueA)(ctx.valueB)(ctx.valueA + ctx.valueB)(ctx.valueC);
            $r3$.????i18nApply(4);
          }
        }
      `;

      verify(input, output);
    });

    it('should correctly bind to context in nested template', () => {
      const input = `
        <div *ngFor="let outer of items">
          <div i18n-title="m|d" title="different scope {{ outer | uppercase }}"></div>
        </div>
      `;

      const i18n_0 = i18nMsg(
          'different scope {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]],
          {meaning: 'm', desc: 'd'});

      const output = String.raw`
        function MyComponent_div_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????elementStart(1, "div", 1);
            $r3$.????pipe(2, "uppercase");
            $r3$.????i18nAttributes(3, 2);
            $r3$.????elementEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            const $outer_r1$ = ctx.$implicit;
            $r3$.????advance(1);
            $r3$.????i18nExp($r3$.????pipeBind1(2, 1, $outer_r1$));
            $r3$.????i18nApply(3);
          }
        }
        ???
        decls: 1,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.Template}, "ngFor", "ngForOf"],
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_div_0_Template, 4, 3, "div", 0);
          }
          if (rf & 2) {
            $r3$.????property("ngForOf", ctx.items);
          }
        }
      `;

      verify(input, output);
    });

    it('should work correctly when placed on i18n root node', () => {
      const input = `
        <div i18n i18n-title="m|d" title="Element title">Some content</div>
      `;

      const i18n_0 = i18nMsg('Element title', [], {meaning: 'm', desc: 'd'});
      const i18n_1 = i18nMsg('Some content');

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$],
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????i18nAttributes(1, 1);
            $r3$.????i18n(2, 2);
            $r3$.????elementEnd();
          }
        }
      `;
      verify(input, output);
    });

    it('should sanitize ids and generate proper variable names', () => {
      const input = `
        <div i18n="@@ID.WITH.INVALID.CHARS.2" i18n-title="@@ID.WITH.INVALID.CHARS" title="Element title">
          Some content
        </div>
      `;

      // Keeping raw content (avoiding `i18nMsg`) to illustrate message id sanitization.
      const output = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_EXTERNAL_ID_WITH_INVALID_CHARS$$APP_SPEC_TS_1$ = goog.getMsg("Element title");
            $I18N_0$ = $MSG_EXTERNAL_ID_WITH_INVALID_CHARS$$APP_SPEC_TS_1$;
        }
        else {
            $I18N_0$ = $localize \`:@@ID.WITH.INVALID.CHARS:Element title\`;
        }
        ???
        let $I18N_2$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_EXTERNAL_ID_WITH_INVALID_CHARS_2$$APP_SPEC_TS_4$ = goog.getMsg(" Some content ");
            $I18N_2$ = $MSG_EXTERNAL_ID_WITH_INVALID_CHARS_2$$APP_SPEC_TS_4$;
        }
        else {
            $I18N_2$ = $localize \`:@@ID.WITH.INVALID.CHARS.2: Some content \`;
        }
      `;

      const exceptions = {
        'ID.WITH.INVALID.CHARS': 'Verify const name generation only',
        'ID.WITH.INVALID.CHARS.2': 'Verify const name generation only'
      };
      verify(input, output, {exceptions, skipPathBasedCheck: true});
    });
  });

  describe('nested nodes', () => {
    it('should not produce instructions for empty content', () => {
      const input = `
        <div i18n></div>
        <div i18n>  </div>
        <div i18n>

        </div>
      `;

      const output = String.raw`
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????element(0, "div");
            $r3$.????element(1, "div");
            $r3$.????element(2, "div");
          }
        }
      `;

      const exceptions = {
        '6524085439495453930': 'No translation is produced for empty content (whitespaces)',
        '814405839137385666': 'No translation is produced for empty content (line breaks)'
      };
      verify(input, output, {exceptions});
    });

    it('should ignore HTML comments within translated text', () => {
      const input = `<div i18n>Some <!-- comments --> text</div>`;
      const output = i18nMsg('Some  text');
      verify(input, output);
    });

    it('should properly escape quotes in content', () => {
      const input = `
        <div i18n>Some text 'with single quotes', "with double quotes", \`with backticks\` and without quotes.</div>
      `;

      // Keeping raw content (avoiding `i18nMsg`) to illustrate quotes escaping.
      const output = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_EXTERNAL_4924931801512133405$$APP_SPEC_TS_0$ = goog.getMsg("Some text 'with single quotes', \"with double quotes\", ` +
          '`with backticks`' + String.raw` and without quotes.");
            $I18N_0$ = $MSG_EXTERNAL_4924931801512133405$$APP_SPEC_TS_0$;
        }
        else {
            $I18N_0$ = $localize \`Some text 'with single quotes', "with double quotes", \\\`with backticks\\\` and without quotes.\`;
        }
      `;

      verify(input, output);
    });

    it('should handle interpolations wrapped in backticks', () => {
      const input = '<div i18n>`{{ count }}`</div>';
      // Keeping raw content (avoiding `i18nMsg`) to illustrate backticks escaping.
      const output = String.raw`
      let $I18N_0$;
      if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
          const $MSG_APP_SPEC_TS_1$ = goog.getMsg("` +
          '`{$interpolation}`' + String.raw`", { "interpolation": "\uFFFD0\uFFFD" });
          $I18N_0$ = $MSG_APP_SPEC_TS_1$;
      }
      else {
          $I18N_0$ = $localize \`\\\`$` +
          String.raw`{"\uFFFD0\uFFFD"}:INTERPOLATION:\\\`\`;
      }`;
      verify(input, output);
    });

    it('should handle i18n attributes with plain-text content', () => {
      const input = `
        <div i18n>My i18n block #1</div>
        <div>My non-i18n block #1</div>
        <div i18n>My i18n block #2</div>
        <div>My non-i18n block #2</div>
        <div i18n>My i18n block #3</div>
      `;

      const i18n_0 = i18nMsg('My i18n block #1');
      const i18n_1 = i18nMsg('My i18n block #2');
      const i18n_2 = i18nMsg('My i18n block #3');

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          return [
            $i18n_0$,
            $i18n_1$,
            $i18n_2$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
            $r3$.????elementStart(2, "div");
            $r3$.????text(3, "My non-i18n block #1");
            $r3$.????elementEnd();
            $r3$.????elementStart(4, "div");
            $r3$.????i18n(5, 1);
            $r3$.????elementEnd();
            $r3$.????elementStart(6, "div");
            $r3$.????text(7, "My non-i18n block #2");
            $r3$.????elementEnd();
            $r3$.????elementStart(8, "div");
            $r3$.????i18n(9, 2);
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should support named interpolations', () => {
      const input = `
        <div i18n>
          Named interpolation: {{ valueA // i18n(ph="PH_A") }}
          Named interpolation with spaces: {{ valueB // i18n(ph="PH B") }}
        </div>
      `;

      // Keeping raw content (avoiding `i18nMsg`) to illustrate how named interpolations are
      // generated.
      const i18n_0 = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_EXTERNAL_7597881511811528589$$APP_SPEC_TS_0$ = goog.getMsg(" Named interpolation: {$phA} Named interpolation with spaces: {$phB} ", {
              "phA": "\uFFFD0\uFFFD",
              "phB": "\uFFFD1\uFFFD"
            });
            $I18N_0$ = $MSG_EXTERNAL_7597881511811528589$$APP_SPEC_TS_0$;
        }
        else {
            $I18N_0$ = $localize \` Named interpolation: $` +
          String.raw`{"\uFFFD0\uFFFD"}:PH_A: Named interpolation with spaces: $` +
          String.raw`{"\uFFFD1\uFFFD"}:PH_B: \`;
        }
      `;

      const output = String.raw`
        decls: 2,
        vars: 2,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.valueA)(ctx.valueB);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should support interpolation with custom interpolation config', () => {
      const input = `
        <div i18n>{% valueA %}</div>
      `;

      const i18n_0 = i18nMsg('{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.valueA);
            $r3$.????i18nApply(1);
          }
        }
      `;
      verify(input, output, {inputArgs: {interpolation: ['{%', '%}']}});
    });

    it('should support interpolations with complex expressions', () => {
      const input = `
        <div i18n>
          {{ valueA | async }}
          {{ valueA?.a?.b }}
          {{ valueA.getRawValue()?.getTitle() }}
        </div>
      `;

      const i18n_0 = i18nMsg(' {$interpolation} {$interpolation_1} {$interpolation_2} ', [
        ['interpolation', String.raw`\uFFFD0\uFFFD`],
        ['interpolation_1', String.raw`\uFFFD1\uFFFD`],
        ['interpolation_2', String.raw`\uFFFD2\uFFFD`]
      ]);

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????pipe(2, "async");
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            let $tmp_2_0$ = null;
            $r3$.????advance(2);
            $r3$.????i18nExp($r3$.????pipeBind1(2, 3, ctx.valueA))
                          (ctx.valueA == null ? null : ctx.valueA.a == null ? null : ctx.valueA.a.b)
                          (($tmp_2_0$ = ctx.valueA.getRawValue()) == null ? null : $tmp_2_0$.getTitle());
            $r3$.????i18nApply(1);
          }
        }
      `;
      verify(input, output);
    });

    it('should handle i18n attributes with bindings in content', () => {
      const input = `
        <div i18n>My i18n block #{{ one }}</div>
        <div i18n>My i18n block #{{ two | uppercase }}</div>
        <div i18n>My i18n block #{{ three + four + five }}</div>
      `;

      const i18n_0 = i18nMsg(
          'My i18n block #{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_1 = i18nMsg(
          'My i18n block #{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_2 = i18nMsg(
          'My i18n block #{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 7,
        vars: 5,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          return [
            $i18n_0$,
            $i18n_1$,
            $i18n_2$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
            $r3$.????elementStart(2, "div");
            $r3$.????i18n(3, 1);
            $r3$.????pipe(4, "uppercase");
            $r3$.????elementEnd();
            $r3$.????elementStart(5, "div");
            $r3$.????i18n(6, 2);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.one);
            $r3$.????i18nApply(1);
            $r3$.????advance(3);
            $r3$.????i18nExp($r3$.????pipeBind1(4, 3, ctx.two));
            $r3$.????i18nApply(3);
            $r3$.????advance(2);
            $r3$.????i18nExp(ctx.three + ctx.four + ctx.five);
            $r3$.????i18nApply(6);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle i18n attributes with bindings and nested elements in content', () => {
      const input = `
        <div i18n>
          My i18n block #{{ one }}
          <span>Plain text in nested element</span>
        </div>
        <div i18n>
          My i18n block #{{ two | uppercase }}
          <div>
            <div>
              <span>
                More bindings in more nested element: {{ nestedInBlockTwo }}
              </span>
            </div>
          </div>
        </div>
      `;

      const i18n_0 = i18nMsg(
          ' My i18n block #{$interpolation} {$startTagSpan}Plain text in nested element{$closeTagSpan}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['startTagSpan', String.raw`\uFFFD#2\uFFFD`],
            ['closeTagSpan', String.raw`\uFFFD/#2\uFFFD`]
          ]);
      const i18n_1 = i18nMsgWithPostprocess(
          ' My i18n block #{$interpolation} {$startTagDiv}{$startTagDiv}{$startTagSpan} More bindings in more nested element: {$interpolation_1} {$closeTagSpan}{$closeTagDiv}{$closeTagDiv}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['startTagDiv', String.raw`[\uFFFD#6\uFFFD|\uFFFD#7\uFFFD]`],
            ['startTagSpan', String.raw`\uFFFD#8\uFFFD`],
            ['interpolation_1', String.raw`\uFFFD1\uFFFD`],
            ['closeTagSpan', String.raw`\uFFFD/#8\uFFFD`],
            ['closeTagDiv', String.raw`[\uFFFD/#7\uFFFD|\uFFFD/#6\uFFFD]`]
          ]);

      const output = String.raw`
        decls: 9,
        vars: 5,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_0$,
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????element(2, "span");
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
            $r3$.????elementStart(3, "div");
            $r3$.????i18nStart(4, 1);
            $r3$.????pipe(5, "uppercase");
            $r3$.????elementStart(6, "div");
            $r3$.????elementStart(7, "div");
            $r3$.????element(8, "span");
            $r3$.????elementEnd();
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????i18nExp(ctx.one);
            $r3$.????i18nApply(1);
            $r3$.????advance(6);
            $r3$.????i18nExp($r3$.????pipeBind1(5, 3, ctx.two))(ctx.nestedInBlockTwo);
            $r3$.????i18nApply(4);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle i18n attributes with bindings in content and element attributes', () => {
      const input = `
        <div i18n>
          My i18n block #1 with value: {{ valueA }}
          <span i18n-title title="Span title {{ valueB }} and {{ valueC }}">
            Plain text in nested element (block #1)
          </span>
        </div>
        <div i18n>
          My i18n block #2 with value {{ valueD | uppercase }}
          <span i18n-title title="Span title {{ valueE }}">
            Plain text in nested element (block #2)
          </span>
        </div>
      `;

      const i18n_0 = i18nMsg('Span title {$interpolation} and {$interpolation_1}', [
        ['interpolation', String.raw`\uFFFD0\uFFFD`], ['interpolation_1', String.raw`\uFFFD1\uFFFD`]
      ]);
      const i18n_1 = i18nMsg(
          ' My i18n block #1 with value: {$interpolation} {$startTagSpan} Plain text in nested element (block #1) {$closeTagSpan}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['startTagSpan', String.raw`\uFFFD#2\uFFFD`],
            ['closeTagSpan', String.raw`\uFFFD/#2\uFFFD`]
          ]);
      const i18n_2 =
          i18nMsg('Span title {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_3 = i18nMsg(
          ' My i18n block #2 with value {$interpolation} {$startTagSpan} Plain text in nested element (block #2) {$closeTagSpan}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['startTagSpan', String.raw`\uFFFD#7\uFFFD`],
            ['closeTagSpan', String.raw`\uFFFD/#7\uFFFD`]
          ]);

      const output = String.raw`
        decls: 9,
        vars: 7,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          ${i18n_3}
          return [
            $i18n_0$,
            [${AttributeMarker.I18n}, "title"],
            ["title", $i18n_1$],
            $i18n_2$,
            ["title", $i18n_3$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????elementStart(2, "span", 1);
            $r3$.????i18nAttributes(3, 2);
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
            $r3$.????elementStart(4, "div");
            $r3$.????i18nStart(5, 3);
            $r3$.????pipe(6, "uppercase");
            $r3$.????elementStart(7, "span", 1);
            $r3$.????i18nAttributes(8, 4);
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????i18nExp(ctx.valueB)(ctx.valueC);
            $r3$.????i18nApply(3);
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.valueA);
            $r3$.????i18nApply(1);
            $r3$.????advance(4);
            $r3$.????i18nExp(ctx.valueE);
            $r3$.????i18nApply(8);
            $r3$.????advance(1);
            $r3$.????i18nExp($r3$.????pipeBind1(6, 5, ctx.valueD));
            $r3$.????i18nApply(5);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle i18n attributes in nested templates', () => {
      const input = `
        <div>
          Some content
          <div *ngIf="visible">
            <div i18n>
              Some other content {{ valueA }}
              <div>
                More nested levels with bindings {{ valueB | uppercase }}
              </div>
            </div>
          </div>
        </div>
      `;

      const i18n_0 = i18nMsg(
          ' Some other content {$interpolation} {$startTagDiv} More nested levels with bindings {$interpolation_1} {$closeTagDiv}',
          [
            ['interpolation', String.raw`\uFFFD0\uFFFD`],
            ['startTagDiv', String.raw`\uFFFD#3\uFFFD`],
            ['interpolation_1', String.raw`\uFFFD1\uFFFD`],
            ['closeTagDiv', String.raw`\uFFFD/#3\uFFFD`]
          ]);

      const output = String.raw`
        function MyComponent_div_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????elementStart(1, "div");
            $r3$.????i18nStart(2, 1);
            $r3$.????element(3, "div");
            $r3$.????pipe(4, "uppercase");
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(4);
            $r3$.????i18nExp($ctx_r0$.valueA)($r3$.????pipeBind1(4, 2, $ctx_r0$.valueB));
            $r3$.????i18nApply(2);
          }
        }
        ???
        decls: 3,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.Template}, "ngIf"],
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????text(1, " Some content ");
            $r3$.????template(2, MyComponent_div_2_Template, 5, 4, "div", 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????property("ngIf", ctx.visible);
          }
        }
      `;

      verify(input, output);
    });

    it('should ignore i18n attributes on self-closing tags', () => {
      const input = `
        <img src="logo.png" i18n />
        <img src="logo.png" i18n *ngIf="visible" />
        <img src="logo.png" i18n *ngIf="visible" i18n-title title="App logo #{{ id }}" />
      `;

      const i18n_0 =
          i18nMsg('App logo #{$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        function MyComponent_img_1_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????element(0, "img", 0);
          }
        }
        ???
        function MyComponent_img_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "img", 3);
            $r3$.????i18nAttributes(1, 4);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            const $ctx_r1$ = $r3$.????nextContext();
            $r3$.????i18nExp($ctx_r1$.id);
            $r3$.????i18nApply(1);
          }
        }
        ???
        decls: 3,
        vars: 2,
        consts: function() {
          ${i18n_0}
          return [
            ["src", "logo.png"],
            ["src", "logo.png", ${AttributeMarker.Template}, "ngIf"],
            ["src", "logo.png", ${AttributeMarker.Bindings}, "title",
                                ${AttributeMarker.Template}, "ngIf"],
            ["src", "logo.png", ${AttributeMarker.I18n}, "title"],
            ["title", $i18n_0$]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????element(0, "img", 0);
            $r3$.????template(1, MyComponent_img_1_Template, 1, 0, "img", 1);
            $r3$.????template(2, MyComponent_img_2_Template, 2, 1, "img", 2);
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????property("ngIf", ctx.visible);
            $r3$.????advance(1);
            $r3$.????property("ngIf", ctx.visible);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle i18n context in nested templates', () => {
      const input = `
        <div i18n>
          Some content
          <div *ngIf="visible">
            Some other content {{ valueA }}
            <div>
              More nested levels with bindings {{ valueB | uppercase }}
              <div *ngIf="exists">
                Content inside sub-template {{ valueC }}
                <div>
                  Bottom level element {{ valueD }}
                </div>
              </div>
            </div>
          </div>
          <div *ngIf="!visible">
            Some other content {{ valueE + valueF }}
            <div>
              More nested levels with bindings {{ valueG | uppercase }}
            </div>
          </div>
        </div>
      `;

      const i18n_0 = i18nMsgWithPostprocess(
          ' Some content {$startTagDiv_2} Some other content {$interpolation} {$startTagDiv} More nested levels with bindings {$interpolation_1} {$startTagDiv_1} Content inside sub-template {$interpolation_2} {$startTagDiv} Bottom level element {$interpolation_3} {$closeTagDiv}{$closeTagDiv}{$closeTagDiv}{$closeTagDiv}{$startTagDiv_3} Some other content {$interpolation_4} {$startTagDiv} More nested levels with bindings {$interpolation_5} {$closeTagDiv}{$closeTagDiv}',
          [
            ['startTagDiv_2', String.raw`\uFFFD*2:1\uFFFD\uFFFD#1:1\uFFFD`],
            [
              'closeTagDiv',
              String
                  .raw`[\uFFFD/#2:2\uFFFD|\uFFFD/#1:2\uFFFD\uFFFD/*4:2\uFFFD|\uFFFD/#2:1\uFFFD|\uFFFD/#1:1\uFFFD\uFFFD/*2:1\uFFFD|\uFFFD/#2:3\uFFFD|\uFFFD/#1:3\uFFFD\uFFFD/*3:3\uFFFD]`
            ],
            ['startTagDiv_3', String.raw`\uFFFD*3:3\uFFFD\uFFFD#1:3\uFFFD`],
            ['interpolation', String.raw`\uFFFD0:1\uFFFD`],
            ['startTagDiv', String.raw`[\uFFFD#2:1\uFFFD|\uFFFD#2:2\uFFFD|\uFFFD#2:3\uFFFD]`],
            ['interpolation_1', String.raw`\uFFFD1:1\uFFFD`],
            ['startTagDiv_1', String.raw`\uFFFD*4:2\uFFFD\uFFFD#1:2\uFFFD`],
            ['interpolation_2', String.raw`\uFFFD0:2\uFFFD`],
            ['interpolation_3', String.raw`\uFFFD1:2\uFFFD`],
            ['interpolation_4', String.raw`\uFFFD0:3\uFFFD`],
            ['interpolation_5', String.raw`\uFFFD1:3\uFFFD`]
          ]);

      const output = String.raw`
        function MyComponent_div_2_div_4_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 2);
            $r3$.????elementStart(1, "div");
            $r3$.????element(2, "div");
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r2$ = $r3$.????nextContext(2);
            $r3$.????advance(2);
            $r3$.????i18nExp($ctx_r2$.valueC)($ctx_r2$.valueD);
            $r3$.????i18nApply(0);
          }
        }
        function MyComponent_div_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 1);
            $r3$.????elementStart(1, "div");
            $r3$.????elementStart(2, "div");
            $r3$.????pipe(3, "uppercase");
            $r3$.????template(4, MyComponent_div_2_div_4_Template, 3, 2, "div", 1);
            $r3$.????elementEnd();
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(4);
            $r3$.????property("ngIf", $ctx_r0$.exists);
            $r3$.????i18nExp($ctx_r0$.valueA)($r3$.????pipeBind1(3, 3, $ctx_r0$.valueB));
            $r3$.????i18nApply(0);
          }
        }
        ???
        function MyComponent_div_3_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 3);
            $r3$.????elementStart(1, "div");
            $r3$.????element(2, "div");
            $r3$.????pipe(3, "uppercase");
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r1$ = $r3$.????nextContext();
            $r3$.????advance(3);
            $r3$.????i18nExp($ctx_r1$.valueE + $ctx_r1$.valueF)($r3$.????pipeBind1(3, 2, $ctx_r1$.valueG));
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 4,
        vars: 2,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$,
            [${AttributeMarker.Template}, "ngIf"]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????template(2, MyComponent_div_2_Template, 5, 5, "div", 1);
            $r3$.????template(3, MyComponent_div_3_Template, 4, 4, "div", 1);
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????property("ngIf", ctx.visible);
            $r3$.????advance(1);
            $r3$.????property("ngIf", !ctx.visible);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle i18n attribute with directives', () => {
      const input = `
        <div i18n *ngIf="visible">Some other content <span>{{ valueA }}</span></div>
      `;

      const i18n_0 = i18nMsg('Some other content {$startTagSpan}{$interpolation}{$closeTagSpan}', [
        ['startTagSpan', String.raw`\uFFFD#2\uFFFD`], ['interpolation', String.raw`\uFFFD0\uFFFD`],
        ['closeTagSpan', String.raw`\uFFFD/#2\uFFFD`]
      ]);

      const output = String.raw`
        function MyComponent_div_0_Template(rf, ctx) {
          if (rf & 1) {
              $r3$.????elementStart(0, "div");
              $r3$.????i18nStart(1, 1);
              $r3$.????element(2, "span");
              $r3$.????i18nEnd();
              $r3$.????elementEnd();
          }
          if (rf & 2) {
              const $ctx_r0$ = $r3$.????nextContext();
              $r3$.????advance(2);
              $r3$.????i18nExp($ctx_r0$.valueA);
              $r3$.????i18nApply(1);
          }
        }
        ???
        decls: 1,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.Template}, "ngIf"],
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_div_0_Template, 3, 1, "div", 0);
          }
          if (rf & 2) {
            $r3$.????property("ngIf", ctx.visible);
          }
        }
      `;

      verify(input, output);
    });

    it('should generate event listeners instructions before i18n ones', () => {
      const input = `
        <div i18n (click)="onClick()">Hello</div>
      `;

      const i18n_0 = i18nMsg('Hello');

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            [${AttributeMarker.Bindings}, "click"],
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 0);
            $r3$.????listener("click", function MyComponent_Template_div_click_0_listener() { return ctx.onClick(); });
            $r3$.????i18n(1, 1);
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });
  });

  describe('self-closing i18n instructions', () => {
    it('should be generated with text-only content', () => {
      const input = `
        <div i18n>My i18n block #1</div>
      `;

      const i18n_0 = i18nMsg('My i18n block #1');

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should be generated for ICU-only i18n blocks', () => {
      const input = `
        <div i18n>{age, select, 10 {ten} 20 {twenty} other {other}}</div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 2,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.age);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should be generated within <ng-container> and <ng-template> blocks', () => {
      const input = `
        <ng-template i18n>My i18n block #1</ng-template>
        <ng-container i18n>My i18n block #2</ng-container>
      `;

      const i18n_0 = i18nMsg('My i18n block #2');
      const i18n_1 = i18nMsg('My i18n block #1');

      const output = String.raw`
        function MyComponent_ng_template_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 1);
          }
        }
        ???
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_0$,
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_ng_template_0_Template, 1, 0, "ng-template");
            $r3$.????elementContainerStart(1);
            $r3$.????i18n(2, 0);
            $r3$.????elementContainerEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should not be generated in case we have styling instructions', () => {
      const input = `
        <span i18n class="myClass">Text #1</span>
        <span i18n style="padding: 10px;">Text #2</span>
      `;

      const i18n_0 = i18nMsg('Text #1');
      const i18n_1 = i18nMsg('Text #2');

      const output = String.raw`
        decls: 4,
        vars: 0,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            [${AttributeMarker.Classes}, "myClass"],
            $i18n_0$,
            [${AttributeMarker.Styles}, "padding", "10px"],
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "span", 0);
            $r3$.????i18n(1, 1);
            $r3$.????elementEnd();
            $r3$.????elementStart(2, "span", 2);
            $r3$.????i18n(3, 3);
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });
  });

  describe('ng-container and ng-template', () => {
    it('should handle single translation message using <ng-container>', () => {
      const input = `
        <ng-container i18n>Some content: {{ valueA | uppercase }}</ng-container>
      `;

      const i18n_0 =
          i18nMsg('Some content: {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 3,
        vars: 3,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementContainerStart(0);
            $r3$.????i18n(1, 0);
            $r3$.????pipe(2, "uppercase");
            $r3$.????elementContainerEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????i18nExp($r3$.????pipeBind1(2, 1, ctx.valueA));
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle single translation message using <ng-template>', () => {
      const input = `
        <ng-template i18n>Some content: {{ valueA | uppercase }}</ng-template>
      `;

      const i18n_0 =
          i18nMsg('Some content: {$interpolation}', [['interpolation', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        function MyComponent_ng_template_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 0);
            $r3$.????pipe(1, "uppercase");
          } if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(1);
            $r3$.????i18nExp($r3$.????pipeBind1(1, 1, $ctx_r0$.valueA));
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 1,
        vars: 0,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_ng_template_0_Template, 2, 3, "ng-template");
          }
        }
      `;

      verify(input, output);
    });

    it('should be able to act as child elements inside i18n block', () => {
      const input = `
        <div i18n>
          <ng-template>Template content: {{ valueA | uppercase }}</ng-template>
          <ng-container>Container content: {{ valueB | uppercase }}</ng-container>
        </div>
      `;

      const i18n_0 = i18nMsg(
          '{$startTagNgTemplate}Template content: {$interpolation}{$closeTagNgTemplate}{$startTagNgContainer}Container content: {$interpolation_1}{$closeTagNgContainer}',
          [
            ['startTagNgTemplate', String.raw`\uFFFD*2:1\uFFFD`],
            ['closeTagNgTemplate', String.raw`\uFFFD/*2:1\uFFFD`],
            ['startTagNgContainer', String.raw`\uFFFD#3\uFFFD`],
            ['interpolation_1', String.raw`\uFFFD0\uFFFD`],
            ['closeTagNgContainer', String.raw`\uFFFD/#3\uFFFD`],
            ['interpolation', String.raw`\uFFFD0:1\uFFFD`]
          ]);

      const output = String.raw`
        function MyComponent_ng_template_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 0, 1);
            $r3$.????pipe(1, "uppercase");
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(1);
            $r3$.????i18nExp($r3$.????pipeBind1(1, 1, $ctx_r0$.valueA));
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 5,
        vars: 3,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????template(2, MyComponent_ng_template_2_Template, 2, 3, "ng-template");
            $r3$.????elementContainer(3);
            $r3$.????pipe(4, "uppercase");
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(4);
            $r3$.????i18nExp($r3$.????pipeBind1(4, 1, ctx.valueB));
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle ICUs outside of translatable sections', () => {
      const input = `
        <ng-template>{gender, select, male {male} female {female} other {other}}</ng-template>
        <ng-container>{age, select, 10 {ten} 20 {twenty} other {other}}</ng-container>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_1 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        function MyComponent_ng_template_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 1);
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????i18nExp($ctx_r0$.gender);
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 3,
        vars: 1,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_0$,
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_ng_template_0_Template, 1, 1, "ng-template");
            $r3$.????elementContainerStart(1);
            $r3$.????i18n(2, 0);
            $r3$.????elementContainerEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????i18nExp(ctx.age);
            $r3$.????i18nApply(2);
          }
        }
      `;

      verify(input, output);
    });

    it('should correctly propagate i18n context through nested templates', () => {
      const input = `
        <div i18n>
          <ng-template>
            Template A: {{ valueA | uppercase }}
            <ng-template>
              Template B: {{ valueB }}
              <ng-template>
                Template C: {{ valueC }}
              </ng-template>
            </ng-template>
          </ng-template>
        </div>
      `;

      const i18n_0 = i18nMsgWithPostprocess(
          '{$startTagNgTemplate} Template A: {$interpolation} {$startTagNgTemplate} Template B: {$interpolation_1} {$startTagNgTemplate} Template C: {$interpolation_2} {$closeTagNgTemplate}{$closeTagNgTemplate}{$closeTagNgTemplate}',
          [
            [
              'startTagNgTemplate', String.raw`[\uFFFD*2:1\uFFFD|\uFFFD*2:2\uFFFD|\uFFFD*1:3\uFFFD]`
            ],
            [
              'closeTagNgTemplate',
              String.raw`[\uFFFD/*1:3\uFFFD|\uFFFD/*2:2\uFFFD|\uFFFD/*2:1\uFFFD]`
            ],
            ['interpolation', String.raw`\uFFFD0:1\uFFFD`],
            ['interpolation_1', String.raw`\uFFFD0:2\uFFFD`],
            ['interpolation_2', String.raw`\uFFFD0:3\uFFFD`]
          ]);

      const output = String.raw`
        function MyComponent_ng_template_2_ng_template_2_ng_template_1_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 0, 3);
          }
          if (rf & 2) {
            const $ctx_r2$ = $r3$.????nextContext(3);
            $r3$.????i18nExp($ctx_r2$.valueC);
            $r3$.????i18nApply(0);
          }
        }
        function MyComponent_ng_template_2_ng_template_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 2);
            $r3$.????template(1, MyComponent_ng_template_2_ng_template_2_ng_template_1_Template, 1, 1, "ng-template");
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r1$ = $r3$.????nextContext(2);
            $r3$.????advance(1);
            $r3$.????i18nExp($ctx_r1$.valueB);
            $r3$.????i18nApply(0);
          }
        }
        ???
        function MyComponent_ng_template_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 1);
            $r3$.????pipe(1, "uppercase");
            $r3$.????template(2, MyComponent_ng_template_2_ng_template_2_Template, 2, 1, "ng-template");
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(2);
            $r3$.????i18nExp($r3$.????pipeBind1(1, 1, $ctx_r0$.valueA));
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 3,
        vars: 0,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????template(2, MyComponent_ng_template_2_Template, 3, 3, "ng-template");
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should work with ICUs', () => {
      const input = `
        <ng-container i18n>{gender, select, male {male} female {female} other {other}}</ng-container>
        <ng-template i18n>{age, select, 10 {ten} 20 {twenty} other {other}}</ng-template>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_1 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        function MyComponent_ng_template_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 1);
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????i18nExp($ctx_r0$.age);
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 3,
        vars: 1,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_0$,
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementContainerStart(0);
            $r3$.????i18n(1, 0);
            $r3$.????elementContainerEnd();
            $r3$.????template(2, MyComponent_ng_template_2_Template, 1, 1, "ng-template");
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.gender);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle self-closing tags as content', () => {
      const input = `
        <ng-container i18n>
          <img src="logo.png" title="Logo" /> is my logo #1
        </ng-container>
        <ng-template i18n>
          <img src="logo.png" title="Logo" /> is my logo #2
        </ng-template>
      `;

      const i18n_0 = i18nMsg(
          '{$tagImg} is my logo #1 ', [['tagImg', String.raw`\uFFFD#2\uFFFD\uFFFD/#2\uFFFD`]]);
      const i18n_1 = i18nMsg(
          '{$tagImg} is my logo #2 ', [['tagImg', String.raw`\uFFFD#1\uFFFD\uFFFD/#1\uFFFD`]]);

      const output = String.raw`
        function MyComponent_ng_template_3_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 2);
            $r3$.????element(1, "img", 1);
            $r3$.????i18nEnd();
          }
        }
        ???
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_0$,
            ["src", "logo.png", "title", "Logo"],
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementContainerStart(0);
            $r3$.????i18nStart(1, 0);
            $r3$.????element(2, "img", 1);
            $r3$.????i18nEnd();
            $r3$.????elementContainerEnd();
            $r3$.????template(3, MyComponent_ng_template_3_Template, 2, 0, "ng-template");
          }
        }
      `;

      verify(input, output);
    });

    it('should not emit duplicate i18n consts for nested <ng-container>s', () => {
      const input = `
        <ng-template i18n>
          Root content
          <ng-container *ngIf="visible">
            Nested content
          </ng-container>
        </ng-template>
      `;

      const output =
          i18nMsg(' Root content {$startTagNgContainer} Nested content {$closeTagNgContainer}', [
            ['startTagNgContainer', String.raw`\uFFFD*1:1\uFFFD\uFFFD#1:1\uFFFD`],
            ['closeTagNgContainer', String.raw`\uFFFD/#1:1\uFFFD\uFFFD/*1:1\uFFFD`]
          ]);

      verify(input, output);
    });

    it('should not emit duplicate i18n consts for elements with the same content', () => {
      const input = `
        <div i18n>Test</div>
        <div i18n>Test</div>
      `;

      // TODO(FW-635): currently we generate unique consts for each i18n block even though it
      // might contain the same content. This should be optimized by translation statements caching,
      // that can be implemented in the future.
      const output = String.raw`
        ${i18nMsg('Test')}
        ${i18nMsg('Test')}
      `;

      verify(input, output);
    });

    it('should generate a self-closing container instruction for ng-container inside i18n', () => {
      const input = `
        <div i18n>
          Hello <ng-container>there</ng-container>
        </div>
      `;

      const i18n_0 = i18nMsg(' Hello {$startTagNgContainer}there{$closeTagNgContainer}', [
        ['startTagNgContainer', String.raw`\uFFFD#2\uFFFD`],
        ['closeTagNgContainer', String.raw`\uFFFD/#2\uFFFD`]
      ]);

      const output = String.raw`
        decls: 3,
        vars: 0,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????elementContainer(2);
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should not generate a self-closing container instruction for ng-container with non-text content inside i18n',
       () => {
         const input = `
          <div i18n>
            Hello <ng-container>there <strong>!</strong></ng-container>
          </div>
        `;

         const i18n_0 = i18nMsg(
             ' Hello {$startTagNgContainer}there {$startTagStrong}!{$closeTagStrong}{$closeTagNgContainer}',
             [
               ['startTagNgContainer', String.raw`\uFFFD#2\uFFFD`],
               ['startTagStrong', String.raw`\uFFFD#3\uFFFD`],
               ['closeTagStrong', String.raw`\uFFFD/#3\uFFFD`],
               ['closeTagNgContainer', String.raw`\uFFFD/#2\uFFFD`]
             ]);

         const output = String.raw`
          decls: 4,
          vars: 0,
          consts: function() {
            ${i18n_0}
            return [
              $i18n_0$
            ];
          },
          template: function MyComponent_Template(rf, ctx) {
            if (rf & 1) {
              $r3$.????elementStart(0, "div");
              $r3$.????i18nStart(1, 0);
              $r3$.????elementContainerStart(2);
              $r3$.????element(3, "strong");
              $r3$.????elementContainerEnd();
              $r3$.????i18nEnd();
              $r3$.????elementEnd();
            }
          }
        `;

         verify(input, output);
       });

    // Note: applying structural directives to <ng-template> is typically user error,
    // but it is technically allowed, so we need to support it.
    it('should handle structural directives', () => {
      const input = `
        <ng-template *ngIf="someFlag" i18n>Content A</ng-template>
        <ng-container *ngIf="someFlag" i18n>Content B</ng-container>
      `;

      const i18n_0 = i18nMsg('Content A');
      const i18n_1 = i18nMsg('Content B');

      const output = String.raw`
        function MyComponent_0_ng_template_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 1);
          }
        }
        function MyComponent_0_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_0_ng_template_0_Template, 1, 0, "ng-template");
          }
        }
        ???
        function MyComponent_ng_container_1_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementContainerStart(0);
            $r3$.????i18n(1, 2);
            $r3$.????elementContainerEnd();
          }
        }
        ???
        decls: 2,
        vars: 2,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            [${AttributeMarker.Template}, "ngIf"],
            $i18n_0$,
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????template(0, MyComponent_0_Template, 1, 0, undefined, 0);
            $r3$.????template(1, MyComponent_ng_container_1_Template, 2, 0, "ng-container", 0);
          }
          if (rf & 2) {
            $r3$.????property("ngIf", ctx.someFlag);
            $r3$.????advance(1);
            $r3$.????property("ngIf", ctx.someFlag);
          }
        }
      `;
      verify(input, output);
    });
  });

  describe('whitespace preserving mode', () => {
    it('should keep inner content of i18n block as is', () => {
      const input = `
        <div i18n>
          Some text
          <span>Text inside span</span>
        </div>
      `;

      // Keeping raw content (avoiding `i18nMsg`) to illustrate message layout
      // in case of whitespace preserving mode.
      const i18n_0 = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_EXTERNAL_963542717423364282$$APP_SPEC_TS_0$ = goog.getMsg("\n          Some text\n          {$startTagSpan}Text inside span{$closeTagSpan}\n        ", {
              "startTagSpan": "\uFFFD#3\uFFFD",
              "closeTagSpan": "\uFFFD/#3\uFFFD"
            });
            $I18N_0$ = $MSG_EXTERNAL_963542717423364282$$APP_SPEC_TS_0$;
        }
        else {
            $I18N_0$ = $localize \`
          Some text
          $` +
          String.raw`{"\uFFFD#3\uFFFD"}:START_TAG_SPAN:Text inside span$` +
          String.raw`{"\uFFFD/#3\uFFFD"}:CLOSE_TAG_SPAN:
        \`;
        }
      `;

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????text(0, "\n        ");
            $r3$.????elementStart(1, "div");
            $r3$.????i18nStart(2, 0);
            $r3$.????element(3, "span");
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
            $r3$.????text(4, "\n      ");
          }
        }
      `;

      verify(input, output, {inputArgs: {preserveWhitespaces: true}});
    });
  });

  describe('icu logic', () => {
    it('should handle single icus', () => {
      const input = `
        <div i18n>{gender, select, male {male} female {female} other {other}}</div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 2,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.gender);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should properly escape quotes in content', () => {
      const input = `
        <div i18n>{gender, select, single {'single quotes'} double {"double quotes"} other {other}}</div>
      `;

      const output = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_EXTERNAL_4166854826696768832$$APP_SPEC_TS_0$ = goog.getMsg("{VAR_SELECT, select, single {'single quotes'} double {\"double quotes\"} other {other}}");
            $I18N_0$ = $MSG_EXTERNAL_4166854826696768832$$APP_SPEC_TS_0$;
        }
        else {
            $I18N_0$ = $localize \`{VAR_SELECT, select, single {'single quotes'} double {"double quotes"} other {other}}\`;
        }
        $I18N_0$ = $r3$.????i18nPostprocess($I18N_0$, {
          "VAR_SELECT": "\uFFFD0\uFFFD"
        });
      `;

      verify(input, output);
    });

    it('should support ICU-only templates', () => {
      const input = `
        {age, select, 10 {ten} 20 {twenty} other {other}}
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);

      const output = String.raw`
        decls: 1,
        vars: 1,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18n(0, 0);
          }
          if (rf & 2) {
            $r3$.????i18nExp(ctx.age);
            $r3$.????i18nApply(0);
          }
        }
      `;

      verify(input, output);
    });

    it('should generate i18n instructions for icus generated outside of i18n blocks', () => {
      const input = `
        <div>{gender, select, male {male} female {female} other {other}}</div>
        <div *ngIf="visible" title="icu only">
          {age, select, 10 {ten} 20 {twenty} other {other}}
        </div>
        <div *ngIf="available" title="icu and text">
          You have {count, select, 0 {no emails} 1 {one email} other {{{count}} emails}}.
        </div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_1 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_2 = i18nIcuMsg(
          '{VAR_SELECT, select, 0 {no emails} 1 {one email} other {{INTERPOLATION} emails}}', [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`], ['INTERPOLATION', String.raw`\uFFFD1\uFFFD`]
          ]);

      const output = String.raw`
        function MyComponent_div_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 3);
            $r3$.????text(1, " ");
            $r3$.????i18n(2, 4);
            $r3$.????text(3, " ");
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(2);
            $r3$.????i18nExp($ctx_r0$.age);
            $r3$.????i18nApply(2);
          }
        }
        ???
        function MyComponent_div_3_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div", 5);
            $r3$.????text(1, " You have ");
            $r3$.????i18n(2, 6);
            $r3$.????text(3, ". ");
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            const $ctx_r1$ = $r3$.????nextContext();
            $r3$.????advance(2);
            $r3$.????i18nExp($ctx_r1$.count)($ctx_r1$.count);
            $r3$.????i18nApply(2);
          }
        }
        ???
        decls: 4,
        vars: 3,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          return [
            $i18n_0$,
            ["title", "icu only", ${AttributeMarker.Template}, "ngIf"],
            ["title", "icu and text", ${AttributeMarker.Template}, "ngIf"],
            ["title", "icu only"],
            $i18n_1$,
            ["title", "icu and text"],
            $i18n_2$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
            $r3$.????template(2, MyComponent_div_2_Template, 4, 1, "div", 1);
            $r3$.????template(3, MyComponent_div_3_Template, 4, 2, "div", 2);
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.gender);
            $r3$.????i18nApply(1);
            $r3$.????advance(1);
            $r3$.????property("ngIf", ctx.visible);
            $r3$.????advance(1);
            $r3$.????property("ngIf", ctx.available);
          }
        }
      `;

      verify(input, output);
    });

    it('should support interpolation with custom interpolation config', () => {
      const input = `
        <div i18n>{age, select, 10 {ten} 20 {twenty} other {{% other %}}}</div>
      `;

      const i18n_0 =
          i18nIcuMsg('{VAR_SELECT, select, 10 {ten} 20 {twenty} other {{INTERPOLATION}}}', [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`], ['INTERPOLATION', String.raw`\uFFFD1\uFFFD`]
          ]);

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.age)(ctx.other);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output, {inputArgs: {interpolation: ['{%', '%}']}});
    });

    it('should handle icus with html', () => {
      const input = `
        <div i18n>
          {gender, select, male {male - <b>male</b>} female {female <b>female</b>} other {<div class="other"><i>other</i></div>}}
          <b>Other content</b>
          <div class="other"><i>Another content</i></div>
        </div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male - {START_BOLD_TEXT}male{CLOSE_BOLD_TEXT}} female {female {START_BOLD_TEXT}female{CLOSE_BOLD_TEXT}} other {{START_TAG_DIV}{START_ITALIC_TEXT}other{CLOSE_ITALIC_TEXT}{CLOSE_TAG_DIV}}}',
          [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`],
            ['START_BOLD_TEXT', '<b>'],
            ['CLOSE_BOLD_TEXT', '</b>'],
            ['START_ITALIC_TEXT', '<i>'],
            ['CLOSE_ITALIC_TEXT', '</i>'],
            ['START_TAG_DIV', '<div class=\\"other\\">'],
            ['CLOSE_TAG_DIV', '</div>'],
          ]);

      const i18n_1 = i18nMsg(
          ' {$icu} {$startBoldText}Other content{$closeBoldText}{$startTagDiv}{$startItalicText}Another content{$closeItalicText}{$closeTagDiv}',
          [
            ['startBoldText', String.raw`\uFFFD#2\uFFFD`],
            ['closeBoldText', String.raw`\uFFFD/#2\uFFFD`],
            ['startTagDiv', String.raw`\uFFFD#3\uFFFD`],
            ['startItalicText', String.raw`\uFFFD#4\uFFFD`],
            ['closeItalicText', String.raw`\uFFFD/#4\uFFFD`],
            ['closeTagDiv', String.raw`\uFFFD/#3\uFFFD`],
            ['icu', '$I18N_0$'],
          ]);

      const output = String.raw`
        decls: 5,
        vars: 1,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_1$,
            [${AttributeMarker.Classes}, "other"]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????element(2, "b");
            $r3$.????elementStart(3, "div", 1);
            $r3$.????element(4, "i");
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(4);
            $r3$.????i18nExp(ctx.gender);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle icus with expressions', () => {
      const input = `
        <div i18n>{gender, select, male {male of age: {{ ageA + ageB + ageC }}} female {female} other {other}}</div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male of age: {INTERPOLATION}} female {female} other {other}}',
          [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`],
            ['INTERPOLATION', String.raw`\uFFFD1\uFFFD`],
          ]);

      const output = String.raw`
        decls: 2,
        vars: 2,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.gender)(ctx.ageA + ctx.ageB + ctx.ageC);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle multiple icus in one block', () => {
      const input = `
        <div i18n>
          {gender, select, male {male} female {female} other {other}}
          {age, select, 10 {ten} 20 {twenty} 30 {thirty} other {other}}
        </div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_1 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} 30 {thirty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD1\uFFFD`]]);
      const i18n_2 = i18nMsg(' {$icu} {$icu_1} ', [
        ['icu', '$i18n_0$'],
        ['icu_1', '$i18n_1$'],
      ]);

      const output = String.raw`
        decls: 2,
        vars: 2,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          return [
            $i18n_2$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.gender)(ctx.age);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle multiple icus that share same placeholder', () => {
      const input = `
        <div i18n>
          {gender, select, male {male} female {female} other {other}}
          <div>
            {gender, select, male {male} female {female} other {other}}
          </div>
          <div *ngIf="visible">
            {gender, select, male {male} female {female} other {other}}
          </div>
        </div>
      `;

      // Keeping raw content here to illustrate the difference in placeholders generated for
      // goog.getMsg and $localize calls (see last i18n block).
      const i18n_0 = String.raw`
        let $I18N_1$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_APP_SPEC_TS_1$ = goog.getMsg("{VAR_SELECT, select, male {male} female {female} other {other}}");
            $I18N_1$ = $MSG_APP_SPEC_TS_1$;
        }
        else {
            $I18N_1$ = $localize \`{VAR_SELECT, select, male {male} female {female} other {other}}\`;
        }
        $I18N_1$ = $r3$.????i18nPostprocess($I18N_1$, {
          "VAR_SELECT": "\uFFFD0\uFFFD"
        });
        let $I18N_2$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_APP_SPEC_TS_2$ = goog.getMsg("{VAR_SELECT, select, male {male} female {female} other {other}}");
            $I18N_2$ = $MSG_APP_SPEC_TS_2$;
        }
        else {
            $I18N_2$ = $localize \`{VAR_SELECT, select, male {male} female {female} other {other}}\`;
        }
        $I18N_2$ = $r3$.????i18nPostprocess($I18N_2$, {
          "VAR_SELECT": "\uFFFD1\uFFFD"
        });
        let $I18N_4$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_APP_SPEC_TS__4$ = goog.getMsg("{VAR_SELECT, select, male {male} female {female} other {other}}");
            $I18N_4$ = $MSG_APP_SPEC_TS__4$;
        }
        else {
            $I18N_4$ = $localize \`{VAR_SELECT, select, male {male} female {female} other {other}}\`;
        }
        $I18N_4$ = $r3$.????i18nPostprocess($I18N_4$, {
          "VAR_SELECT": "\uFFFD0:1\uFFFD"
        });
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
            const $MSG_APP_SPEC_TS_0$ = goog.getMsg(" {$icu} {$startTagDiv} {$icu} {$closeTagDiv}{$startTagDiv_1} {$icu} {$closeTagDiv}", {
              "startTagDiv": "\uFFFD#2\uFFFD",
              "closeTagDiv": "[\uFFFD/#2\uFFFD|\uFFFD/#1:1\uFFFD\uFFFD/*3:1\uFFFD]",
              "startTagDiv_1": "\uFFFD*3:1\uFFFD\uFFFD#1:1\uFFFD",
              "icu": "\uFFFDI18N_EXP_ICU\uFFFD"
            });
            $I18N_0$ = $MSG_APP_SPEC_TS_0$;
        }
        else {
            $I18N_0$ = $localize \` $` +
          String.raw`{"\uFFFDI18N_EXP_ICU\uFFFD"}:ICU: $` +
          String.raw`{"\uFFFD#2\uFFFD"}:START_TAG_DIV: $` +
          String.raw`{"\uFFFDI18N_EXP_ICU\uFFFD"}:ICU: $` + String.raw
      `{"[\uFFFD/#2\uFFFD|\uFFFD/#1:1\uFFFD\uFFFD/*3:1\uFFFD]"}:CLOSE_TAG_DIV:$` +
          String.raw`{"\uFFFD*3:1\uFFFD\uFFFD#1:1\uFFFD"}:START_TAG_DIV_1: $` +
          String.raw`{"\uFFFDI18N_EXP_ICU\uFFFD"}:ICU: $` + String.raw
      `{"[\uFFFD/#2\uFFFD|\uFFFD/#1:1\uFFFD\uFFFD/*3:1\uFFFD]"}:CLOSE_TAG_DIV:\`;
        }
        $I18N_0$ = $r3$.????i18nPostprocess($I18N_0$, {
          "ICU": [$I18N_1$, $I18N_2$, $I18N_4$]
        });
      `;

      const output = String.raw`
        function MyComponent_div_3_Template(rf, ctx) {
          if (rf & 1) {
              $r3$.????i18nStart(0, 0, 1);
              $r3$.????element(1, "div");
              $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(1);
            $r3$.????i18nExp($ctx_r0$.gender);
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 4,
        vars: 3,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$,
            [${AttributeMarker.Template}, "ngIf"]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????element(2, "div");
            $r3$.????template(3, MyComponent_div_3_Template, 2, 1, "div", 1);
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(3);
            $r3$.????property("ngIf", ctx.visible);
            $r3$.????i18nExp(ctx.gender)(ctx.gender);
            $r3$.????i18nApply(1);
          }
        }
      `;

      // TODO(FW-635): this use-case is currently supported with
      // file-based prefix for translation const names. Translation statements
      // caching is required to support this use-case with id-based consts.
      verify(input, output, {skipIdBasedCheck: true});
    });

    it('should handle nested icus', () => {
      const input = `
        <div i18n>
          {gender, select,
            male {male of age: {age, select, 10 {ten} 20 {twenty} 30 {thirty} other {other}}}
            female {female}
            other {other}
          }
        </div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT_1, select, male {male of age: {VAR_SELECT, select, 10 {ten} 20 {twenty} 30 {thirty} other {other}}} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`], ['VAR_SELECT_1', String.raw`\uFFFD1\uFFFD`]]);
      const i18n_1 = i18nMsg(' {$icu} ', [['icu', '$i18n_0$']]);

      const output = String.raw`
        decls: 2,
        vars: 2,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          return [
            $i18n_1$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.age)(ctx.gender);
            $r3$.????i18nApply(1);
          }
        }
      `;

      const exceptions = {
        '3052001905251380936': 'Wrapper message generated by "ng xi18n" around ICU: "  {$ICU}  "'
      };
      verify(input, output, {exceptions});
    });

    it('nested with interpolations in "other" blocks', () => {
      const input = `
        <div i18n>{count, plural,
          =0 {zero}
          =2 {{{count}} {name, select,
                cat {cats}
                dog {dogs}
                other {animals}} !}
          other {other - {{count}}}
        }</div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_PLURAL, plural, =0 {zero} =2 {{INTERPOLATION} {VAR_SELECT, select, cat {cats} dog {dogs} other {animals}} !} other {other - {INTERPOLATION}}}',
          [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`],
            ['VAR_PLURAL', String.raw`\uFFFD1\uFFFD`],
            ['INTERPOLATION', String.raw`\uFFFD2\uFFFD`],
          ]);

      const output = String.raw`
        decls: 2,
        vars: 3,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.name)(ctx.count)(ctx.count);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle icus in different contexts', () => {
      const input = `
        <div i18n>
          {gender, select, male {male} female {female} other {other}}
          <span *ngIf="ageVisible">
            {age, select, 10 {ten} 20 {twenty} 30 {thirty} other {other}}
          </span>
        </div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male} female {female} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
      const i18n_1 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} 30 {thirty} other {other}}',
          [['VAR_SELECT', String.raw`\uFFFD0:1\uFFFD`]]);
      const i18n_2 = i18nMsg(' {$icu} {$startTagSpan} {$icu_1} {$closeTagSpan}', [
        ['startTagSpan', String.raw`\uFFFD*2:1\uFFFD\uFFFD#1:1\uFFFD`],
        ['closeTagSpan', String.raw`\uFFFD/#1:1\uFFFD\uFFFD/*2:1\uFFFD`],
        ['icu', '$i18n_0$'],
        ['icu_1', '$i18n_1$'],
      ]);

      const output = String.raw`
        function MyComponent_span_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 1);
            $r3$.????element(1, "span");
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(1);
            $r3$.????i18nExp($ctx_r0$.age);
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 3,
        vars: 2,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          return [
            $i18n_2$,
            [${AttributeMarker.Template}, "ngIf"]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????template(2, MyComponent_span_2_Template, 2, 1, "span", 1);
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????property("ngIf", ctx.ageVisible);
            $r3$.????i18nExp(ctx.gender);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle icus with interpolations', () => {
      const input = `
        <div i18n>
          {gender, select, male {male {{ weight }}} female {female {{ height }}} other {other}}
          <span *ngIf="ageVisible">
            {age, select, 10 {ten} 20 {twenty} 30 {thirty} other {other: {{ otherAge }}}}
          </span>
        </div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male {INTERPOLATION}} female {female {INTERPOLATION_1}} other {other}}',
          [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`],
            ['INTERPOLATION', String.raw`\uFFFD1\uFFFD`],
            ['INTERPOLATION_1', String.raw`\uFFFD2\uFFFD`],
          ]);
      const i18n_1 = i18nIcuMsg(
          '{VAR_SELECT, select, 10 {ten} 20 {twenty} 30 {thirty} other {other: {INTERPOLATION}}}', [
            ['VAR_SELECT', String.raw`\uFFFD0:1\uFFFD`],
            ['INTERPOLATION', String.raw`\uFFFD1:1\uFFFD`],
          ]);
      const i18n_2 = i18nMsg(' {$icu} {$startTagSpan} {$icu_1} {$closeTagSpan}', [
        ['startTagSpan', String.raw`\uFFFD*2:1\uFFFD\uFFFD#1:1\uFFFD`],
        ['closeTagSpan', String.raw`\uFFFD/#1:1\uFFFD\uFFFD/*2:1\uFFFD`],
        ['icu', '$i18n_0$'],
        ['icu_1', '$i18n_1$'],
      ]);

      const output = String.raw`
        function MyComponent_span_2_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????i18nStart(0, 0, 1);
            $r3$.????element(1, "span");
            $r3$.????i18nEnd();
          }
          if (rf & 2) {
            const $ctx_r0$ = $r3$.????nextContext();
            $r3$.????advance(1);
            $r3$.????i18nExp($ctx_r0$.age)($ctx_r0$.otherAge);
            $r3$.????i18nApply(0);
          }
        }
        ???
        decls: 3,
        vars: 4,
        consts: function() {
          ${i18n_0}
          ${i18n_1}
          ${i18n_2}
          return [
            $i18n_2$,
            [${AttributeMarker.Template}, "ngIf"]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18nStart(1, 0);
            $r3$.????template(2, MyComponent_span_2_Template, 2, 2, "span", 1);
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(2);
            $r3$.????property("ngIf", ctx.ageVisible);
            $r3$.????i18nExp(ctx.gender)(ctx.weight)(ctx.height);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should handle icus with named interpolations', () => {
      const input = `
        <div i18n>{
          gender,
          select,
            male {male {{ weight // i18n(ph="PH_A") }}}
            female {female {{ height // i18n(ph="PH_B") }}}
            other {other {{ age // i18n(ph="PH WITH SPACES") }}}
        }</div>
      `;

      const i18n_0 = i18nIcuMsg(
          '{VAR_SELECT, select, male {male {PH_A}} female {female {PH_B}} other {other {PH_WITH_SPACES}}}',
          [
            ['VAR_SELECT', String.raw`\uFFFD0\uFFFD`],
            ['PH_A', String.raw`\uFFFD1\uFFFD`],
            ['PH_B', String.raw`\uFFFD2\uFFFD`],
            ['PH_WITH_SPACES', String.raw`\uFFFD3\uFFFD`],
          ]);

      const output = String.raw`
        decls: 2,
        vars: 4,
        consts: function() {
          ${i18n_0}
          return [
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????elementStart(0, "div");
            $r3$.????i18n(1, 0);
            $r3$.????elementEnd();
          }
          if (rf & 2) {
            $r3$.????advance(1);
            $r3$.????i18nExp(ctx.gender)(ctx.weight)(ctx.height)(ctx.age);
            $r3$.????i18nApply(1);
          }
        }
      `;

      verify(input, output);
    });

    it('should attach metadata in case an ICU represents the whole message', () => {
      const input = `
        <div i18n="meaningA|descA@@idA">{count, select, 1 {one} other {more than one}}</div>
      `;

      const output = i18nMsgWithPostprocess(
          '{VAR_SELECT, select, 1 {one} other {more than one}}', [],
          {meaning: 'meaningA', desc: 'descA', id: 'idA'},
          [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);

      verify(input, output);
    });

    it('should produce proper messages when `select` or `plural` keywords have spaces after them',
       () => {
         const input = `
            <div i18n>
              {count, select , 1 {one} other {more than one}}
              {count, plural , =1 {one} other {more than one}}
            </div>
          `;

         const i18n_0 = i18nIcuMsg(
             '{VAR_SELECT , select , 1 {one} other {more than one}}',
             [['VAR_SELECT', String.raw`\uFFFD0\uFFFD`]]);
         const i18n_1 = i18nIcuMsg(
             '{VAR_PLURAL , plural , =1 {one} other {more than one}}',
             [['VAR_PLURAL', String.raw`\uFFFD1\uFFFD`]]);

         const output = String.raw`
            ${i18n_0}
            ${i18n_1}
          `;

         verify(input, output);
       });
  });

  describe('$localize legacy message ids', () => {
    it('should add legacy message ids if `enableI18nLegacyMessageIdFormat` is true', () => {
      const input = `<div i18n>Some Message</div>`;

      const output = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) { ??? }
        else {
            $I18N_0$ = $localize \`:???ec93160d6d6a8822214060dd7938bf821c22b226???6795333002533525253:Some Message\`;
        }
        ???
        `;

      verify(input, output, {compilerOptions: {enableI18nLegacyMessageIdFormat: true}});
    });

    it('should add legacy message ids if `enableI18nLegacyMessageIdFormat` is undefined', () => {
      const input = `<div i18n>Some Message</div>`;

      const output = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) { ??? }
        else {
            $I18N_0$ = $localize \`:???ec93160d6d6a8822214060dd7938bf821c22b226???6795333002533525253:Some Message\`;
        }
        ???
        `;

      verify(input, output, {compilerOptions: {enableI18nLegacyMessageIdFormat: undefined}});
    });
  });

  describe('line ending normalization', () => {
    [true, false].forEach(
        templateUrl => describe(templateUrl ? '[templateUrl]' : '[inline template]', () => {
          [true, false, undefined].forEach(
              i18nNormalizeLineEndingsInICUs => describe(
                  `{i18nNormalizeLineEndingsInICUs: ${i18nNormalizeLineEndingsInICUs}}`, () => {
                    it('should normalize line endings in templates', () => {
                      const input =
                          `<div title="abc\r\ndef" i18n-title i18n>\r\nSome Message\r\n{\r\n  value,\r\n  select,\r\n  =0 {\r\n    zero\r\n  }\r\n}</div>`;

                      const output = String.raw`
        $I18N_0$ = $localize \`abc
def\`;
        ???
        $I18N_4$ = $localize \`{VAR_SELECT, select, =0 {zero
  }}\`
        ???
        $I18N_3$ = $localize \`
Some Message
$` + String.raw`{$I18N_4$}:ICU:\`;
        `;

                      verify(input, output, {
                        inputArgs: {templateUrl},
                        compilerOptions: {i18nNormalizeLineEndingsInICUs}
                      });
                    });

                    it('should compute the correct message id for messages', () => {
                      const input =
                          `<div title="abc\r\ndef" i18n-title i18n>\r\nSome Message\r\n{\r\n  value,\r\n  select,\r\n  =0 {\r\n    zero\r\n  }\r\n}</div>`;

                      // The ids generated by the compiler are different if the template is external
                      // and we are not explicitly normalizing the line endings.
                      const ICU_EXPRESSION_ID =
                          templateUrl && i18nNormalizeLineEndingsInICUs !== true ?
                          `???70a685282be2d956e4db234fa3d985970672faa0` :
                          `???b5fe162f4e47ab5b3e534491d30b715e0dff0f52`;
                      const ICU_ID = templateUrl && i18nNormalizeLineEndingsInICUs !== true ?
                          `???6a55b51b9bcf8f84b1b868c585ae09949668a72b` :
                          `???e31c7bc4db2f2e56dc40f005958055a02fd43a2e`;

                      const output =
                          String.raw`
        $I18N_0$ = $localize \`:???4f9ce2c66b187afd9898b25f6336d1eb2be8b5dc???7326958852138509669:abc
def\`;
        ???
        $I18N_4$ = $localize \`:${
                              ICU_EXPRESSION_ID}???4863953183043480207:{VAR_SELECT, select, =0 {zero
  }}\`
        ???
        $I18N_3$ = $localize \`:${ICU_ID}???2773178924738647105:
Some Message
$` + String.raw`{$I18N_4$}:ICU:\`;
        `;

                      verify(input, output, {
                        inputArgs: {templateUrl},
                        compilerOptions:
                            {i18nNormalizeLineEndingsInICUs, enableI18nLegacyMessageIdFormat: true}
                      });
                    });
                  }));
        }));
  });

  describe('es5 support', () => {
    it('should generate ES5 compliant localized messages if the target is ES5', () => {
      const input = `
        <div i18n="meaning:A|descA@@idA">Content A</div>
      `;

      const output = String.raw`
        var $I18N_0$;
        ???
        $I18N_0$ = $localize(???__makeTemplateObject([":meaning:A|descA@@idA:Content A"], [":meaning\\:A|descA@@idA:Content A"])???);
      `;

      verify(
          input, output, {skipIdBasedCheck: true, compilerOptions: {target: ts.ScriptTarget.ES5}});
    });
  });

  describe('errors', () => {
    const verifyNestedSectionsError = (errorThrown: any, expectedErrorText: string) => {
      expect(errorThrown.ngParseErrors.length).toBe(1);
      const msg = errorThrown.ngParseErrors[0].toString();
      expect(msg).toContain(
          'Cannot mark an element as translatable inside of a translatable section. Please remove the nested i18n marker.');
      expect(msg).toContain(expectedErrorText);
      expect(msg).toMatch(/app\/spec\.ts\@\d+\:\d+/);
    };

    it('should throw on nested i18n sections', () => {
      const files = getAppFilesWithTemplate(`
        <div i18n>
          <div i18n>Some content</div>
        </div>
      `);
      try {
        compile(files, angularFiles);
      } catch (error) {
        verifyNestedSectionsError(error, '[ERROR ->]<div i18n>Some content</div>');
      }
    });

    it('should throw on nested i18n sections with tags in between', () => {
      const files = getAppFilesWithTemplate(`
        <div i18n>
          <div>
            <div i18n>Some content</div>
          </div>
        </div>
      `);
      try {
        compile(files, angularFiles);
      } catch (error) {
        verifyNestedSectionsError(error, '[ERROR ->]<div i18n>Some content</div>');
      }
    });

    it('should throw on nested i18n sections represented with <ng-container>s', () => {
      const files = getAppFilesWithTemplate(`
        <ng-container i18n>
          <div>
            <ng-container i18n>Some content</ng-container>
          </div>
        </ng-container>
      `);
      try {
        compile(files, angularFiles);
      } catch (error) {
        verifyNestedSectionsError(
            error, '[ERROR ->]<ng-container i18n>Some content</ng-container>');
      }
    });
  });

  describe('namespaces', () => {
    it('should handle namespaces inside i18n blocks', () => {
      const input = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <foreignObject i18n>
            <xhtml:div xmlns="http://www.w3.org/1999/xhtml">
              Count: <span>5</span>
            </xhtml:div>
          </foreignObject>
        </svg>
      `;

      const i18n_0 = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
          const $MSG_EXTERNAL_7128002169381370313$$APP_SPEC_TS_1$ = goog.getMsg("{$startTagXhtmlDiv} Count: {$startTagXhtmlSpan}5{$closeTagXhtmlSpan}{$closeTagXhtmlDiv}", {
            "startTagXhtmlDiv": "\uFFFD#3\uFFFD",
            "startTagXhtmlSpan": "\uFFFD#4\uFFFD",
            "closeTagXhtmlSpan": "\uFFFD/#4\uFFFD",
            "closeTagXhtmlDiv": "\uFFFD/#3\uFFFD"
          });
          $I18N_0$ = $MSG_EXTERNAL_7128002169381370313$$APP_SPEC_TS_1$;
        }
        else {
          $I18N_0$ = $localize \`$` +
          String.raw`{"\uFFFD#3\uFFFD"}:START_TAG__XHTML_DIV: Count: $` +
          String.raw`{"\uFFFD#4\uFFFD"}:START_TAG__XHTML_SPAN:5$` +
          String.raw`{"\uFFFD/#4\uFFFD"}:CLOSE_TAG__XHTML_SPAN:$` +
          String.raw`{"\uFFFD/#3\uFFFD"}:CLOSE_TAG__XHTML_DIV:\`;
        }
      `;

      const output = String.raw`
        ???
        consts: function() {
          ${i18n_0}
          return [
            ["xmlns", "http://www.w3.org/2000/svg"],
            $i18n_0$,
            ["xmlns", "http://www.w3.org/1999/xhtml"]
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????namespaceSVG();
            $r3$.????elementStart(0, "svg", 0);
            $r3$.????elementStart(1, "foreignObject");
            $r3$.????i18nStart(2, 1);
            $r3$.????namespaceHTML();
            $r3$.????elementStart(3, "div", 2);
            $r3$.????element(4, "span");
            $r3$.????elementEnd();
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });

    it('should handle namespaces on i18n block containers', () => {
      const input = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <foreignObject>
            <xhtml:div xmlns="http://www.w3.org/1999/xhtml" i18n>
              Count: <span>5</span>
            </xhtml:div>
          </foreignObject>
        </svg>
      `;

      const i18n_0 = String.raw`
        let $I18N_0$;
        if (typeof ngI18nClosureMode !== "undefined" && ngI18nClosureMode) {
          const $MSG_EXTERNAL_7428861019045796010$$APP_SPEC_TS_1$ = goog.getMsg(" Count: {$startTagXhtmlSpan}5{$closeTagXhtmlSpan}", {
            "startTagXhtmlSpan": "\uFFFD#4\uFFFD",
            "closeTagXhtmlSpan": "\uFFFD/#4\uFFFD"
          });
          $I18N_0$ = $MSG_EXTERNAL_7428861019045796010$$APP_SPEC_TS_1$;
        }
        else {
          $I18N_0$ = $localize \` Count: $` +
          String.raw`{"\uFFFD#4\uFFFD"}:START_TAG__XHTML_SPAN:5$` +
          String.raw`{"\uFFFD/#4\uFFFD"}:CLOSE_TAG__XHTML_SPAN:\`;
        }
      `;

      const output = String.raw`
        consts: function() {
          ${i18n_0}
          return [
            ["xmlns", "http://www.w3.org/2000/svg"],
            ["xmlns", "http://www.w3.org/1999/xhtml"],
            $i18n_0$
          ];
        },
        template: function MyComponent_Template(rf, ctx) {
          if (rf & 1) {
            $r3$.????namespaceSVG();
            $r3$.????elementStart(0, "svg", 0);
            $r3$.????elementStart(1, "foreignObject");
            $r3$.????namespaceHTML();
            $r3$.????elementStart(2, "div", 1);
            $r3$.????i18nStart(3, 2);
            $r3$.????element(4, "span");
            $r3$.????i18nEnd();
            $r3$.????elementEnd();
            $r3$.????elementEnd();
            $r3$.????elementEnd();
          }
        }
      `;

      verify(input, output);
    });
  });
});
