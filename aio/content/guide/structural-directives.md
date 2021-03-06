# Structural directives

<style>
  h4 {font-size: 17px !important; text-transform: none !important;}
  .syntax { font-family: Consolas, 'Lucida Sans', Courier, sans-serif; color: black; font-size: 85%; }

</style>



This guide looks at how Angular manipulates the DOM with **structural directives** and
how you can write your own structural directives to do the same thing.

Try the <live-example></live-example>.


{@a definition}



## What are structural directives?

Structural directives are responsible for HTML layout.
They shape or reshape the DOM's _structure_, typically by adding, removing, or manipulating
elements.

As with other directives, you apply a structural directive to a _host element_.
The directive then does whatever it's supposed to do with that host element and its descendants.

Structural directives are easy to recognize.
An asterisk (*) precedes the directive attribute name as in this example.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngif)" region="ngif"></code-example>



No brackets. No parentheses. Just `*ngIf` set to a string.

You'll learn in this guide that the [asterisk (*) is a convenience notation](guide/structural-directives#asterisk)
and the string is a [_microsyntax_](guide/structural-directives#microsyntax) rather than the usual
[template expression](guide/interpolation#template-expressions).
Angular desugars this notation into a marked-up `<ng-template>` that surrounds the
host element and its descendants.
Each structural directive does something different with that template.

Three of the common, built-in structural directives&mdash;[NgIf](guide/built-in-directives#ngIf),
[NgFor](guide/built-in-directives#ngFor), and [NgSwitch...](guide/built-in-directives#ngSwitch)&mdash;are
described in the [Built-in directives](guide/built-in-directives) guide and seen in samples throughout the Angular documentation.
Here's an example of them in a template:


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (built-in)" region="built-in"></code-example>



This guide won't repeat how to _use_ them. But it does explain _how they work_
and how to [write your own](guide/structural-directives#unless) structural directive.


<div class="callout is-helpful">



<header>
  Directive spelling
</header>



Throughout this guide, you'll see a directive spelled in both _UpperCamelCase_ and _lowerCamelCase_.
Already you've seen `NgIf` and `ngIf`.
There's a reason. `NgIf` refers to the directive _class_;
`ngIf` refers to the directive's _attribute name_.

A directive _class_ is spelled in _UpperCamelCase_ (`NgIf`).
A directive's _attribute name_ is spelled in _lowerCamelCase_ (`ngIf`).
The guide refers to the directive _class_ when talking about its properties and what the directive does.
The guide refers to the _attribute name_ when describing how
you apply the directive to an element in the HTML template.


</div>



<div class="alert is-helpful">



There are two other kinds of Angular directives, described extensively elsewhere:
(1)&nbsp;components and (2)&nbsp;attribute directives.

A *component* manages a region of HTML in the manner of a native HTML element.
Technically it's a directive with a template.

An [*attribute* directive](guide/attribute-directives) changes the appearance or behavior
of an element, component, or another directive.
For example, the built-in [`NgStyle`](guide/built-in-directives#ngStyle) directive
changes several element styles at the same time.

You can apply many _attribute_ directives to one host element.
You can [only apply one](guide/structural-directives#one-per-element) _structural_ directive to a host element.


</div>



{@a ngIf}



## NgIf case study

`NgIf` is the simplest structural directive and the easiest to understand.
It takes a boolean expression and makes an entire chunk of the DOM appear or disappear.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngif-true)" region="ngif-true"></code-example>



The `ngIf` directive doesn't hide elements with CSS. It adds and removes them physically from the DOM.
Confirm that fact using browser developer tools to inspect the DOM.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/element-not-in-dom.png' alt="ngIf=false element not in DOM">
</div>



The top paragraph is in the DOM. The bottom, disused paragraph is not;
in its place is a comment about "bindings" (more about that [later](guide/structural-directives#asterisk)).

When the condition is false, `NgIf` removes its host element from the DOM,
detaches it from DOM events (the attachments that it made),
detaches the component from Angular change detection, and destroys it.
The component and DOM nodes can be garbage-collected and free up memory.

### Why *remove* rather than *hide*?

A directive could hide the unwanted paragraph instead by setting its `display` style to `none`.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (display-none)" region="display-none"></code-example>



While invisible, the element remains in the DOM.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/element-display-in-dom.png' alt="hidden element still in DOM">
</div>



The difference between hiding and removing doesn't matter for a simple paragraph.
It does matter when the host element is attached to a resource intensive component.
Such a component's behavior continues even when hidden.
The component stays attached to its DOM element. It keeps listening to events.
Angular keeps checking for changes that could affect data bindings.
Whatever the component was doing, it keeps doing.

Although invisible, the component&mdash;and all of its descendant components&mdash;tie up resources.
The performance and memory burden can be substantial, responsiveness can degrade, and the user sees nothing.

On the positive side, showing the element again is quick.
The component's previous state is preserved and ready to display.
The component doesn't re-initialize&mdash;an operation that could be expensive.
So hiding and showing is sometimes the right thing to do.

But in the absence of a compelling reason to keep them around,
your preference should be to remove DOM elements that the user can't see
and recover the unused resources with a structural directive like `NgIf` .

**These same considerations apply to every structural directive, whether built-in or custom.**
Before applying a structural directive, you might want to pause for a moment
to consider the consequences of adding and removing elements and of creating and destroying components.


{@a asterisk}



## The asterisk (*) prefix

Surely you noticed the asterisk (*) prefix to the directive name
and wondered why it is necessary and what it does.

Here is `*ngIf` displaying the hero's name if `hero` exists.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (asterisk)" region="asterisk"></code-example>



The asterisk is "syntactic sugar" for something a bit more complicated.
Internally, Angular translates the `*ngIf` _attribute_ into a `<ng-template>` _element_, wrapped around the host element, like this.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngif-template)" region="ngif-template"></code-example>



* The `*ngIf` directive moved to the `<ng-template>` element where it became a property binding,`[ngIf]`.
* The rest of the `<div>`, including its class attribute, moved inside the `<ng-template>` element.

The first form is not actually rendered, only the finished product ends up in the DOM.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/hero-div-in-dom.png' alt="hero div in DOM">
</div>



Angular consumed the `<ng-template>` content during its actual rendering and
replaced the `<ng-template>` with a diagnostic comment.

The [`NgFor`](guide/structural-directives#ngFor) and [`NgSwitch...`](guide/structural-directives#ngSwitch) directives follow the same pattern.


{@a ngFor}



## Inside _*ngFor_

Angular transforms the `*ngFor` in similar fashion from asterisk (*) syntax to `<ng-template>` _element_.

Here's a full-featured application of `NgFor`, written both ways:


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (inside-ngfor)" region="inside-ngfor"></code-example>



This is manifestly more complicated than `ngIf` and rightly so.
The `NgFor` directive has more features, both required and optional, than the `NgIf` shown in this guide.
At minimum `NgFor` needs a looping variable (`let hero`) and a list (`heroes`).

You enable these features in the string assigned to `ngFor`, which you write in Angular's [microsyntax](guide/structural-directives#microsyntax).


<div class="alert is-helpful">



Everything _outside_ the `ngFor` string stays with the host element
(the `<div>`) as it moves inside the `<ng-template>`.
In this example, the `[class.odd]="odd"` stays on the `<div>`.


</div>



{@a microsyntax}


## Microsyntax

The Angular microsyntax lets you configure a directive in a compact, friendly string.
The microsyntax parser translates that string into attributes on the `<ng-template>`:

* The `let` keyword declares a [_template input variable_](guide/structural-directives#template-input-variable)
that you reference within the template. The input variables in this example are `hero`, `i`, and `odd`.
The parser translates `let hero`, `let i`, and `let odd` into variables named
`let-hero`, `let-i`, and `let-odd`.

* The microsyntax parser title-cases all directives and prefixes them with the directive's
attribute name, such as `ngFor`. For example, the `ngFor` input properties,
`of` and `trackBy`, become `ngForOf` and `ngForTrackBy`, respectively.
That's how the directive learns that the list is `heroes` and the track-by function is `trackById`.

* As the `NgFor` directive loops through the list, it sets and resets properties of its own _context_ object.
These properties can include, but aren't limited to, `index`, `odd`, and a special property
named `$implicit`.

* The `let-i` and `let-odd` variables were defined as `let i=index` and `let odd=odd`.
Angular sets them to the current value of the context's `index` and `odd` properties.

* The context property for `let-hero` wasn't specified.
Its intended source is implicit.
Angular sets `let-hero` to the value of the context's `$implicit` property,
which `NgFor` has initialized with the hero for the current iteration.

* The [`NgFor` API guide](api/common/NgForOf "API: NgFor")
describes additional `NgFor` directive properties and context properties.

* The `NgForOf` directive implements `NgFor`. Read more about additional `NgForOf` directive properties and context properties in the [NgForOf API reference](api/common/NgForOf).

### Writing your own structural directives

These microsyntax mechanisms are also available to you when you write your own structural directives.
For example, microsyntax in Angular allows you to write `<div *ngFor="let item of items">{{item}}</div>`
instead of `<ng-template ngFor let-item [ngForOf]="items"><div>{{item}}</div></ng-template>`.
The following sections provide detailed information on constraints, grammar,
and translation of microsyntax.

### Constraints

Microsyntax must meet the following requirements:

- It must be known ahead of time so that IDEs can parse it without knowing the underlying semantics of the directive or what directives are present.
- It must translate to key-value attributes in the DOM.

### Grammar

When you write your own structural directives, use the following grammar:

```
*:prefix="( :let | :expression ) (';' | ',')? ( :let | :as | :keyExp )*"
```

The following tables describe each portion of the microsyntax grammar.

<!-- What should I put in the table headers? -->

<table>
  <tr>
    <th></th>
    <th></th>
  </tr>
  <tr>
    <td><code>prefix</code></td>
    <td>HTML attribute key</td>
  </tr>
  <tr>
    <td><code>key</code></td>
    <td>HTML attribute key</td>
  </tr>
  <tr>
    <td><code>local</code></td>
    <td>local variable name used in the template</td>
  </tr>
  <tr>
    <td><code>export</code></td>
    <td>value exported by the directive under a given name</td>
  </tr>
  <tr>
    <td><code>expression</code></td>
    <td>standard Angular expression</td>
  </tr>
</table>

<!-- The items in this table seem different. Is there another name for how we should describe them? -->
<table>
  <tr>
    <th></th>
  </tr>
  <tr>
    <td colspan="3"><code>keyExp = :key ":"? :expression ("as" :local)? ";"? </code></td>
  </tr>
  <tr>
    <td colspan="3"><code>let = "let" :local "=" :export ";"?</code></td>
  </tr>
  <tr>
    <td colspan="3"><code>as = :export "as" :local ";"?</code></td>
  </tr>
</table>


### Translation

A microsyntax is translated to the normal binding syntax as follows:

<!-- What to put in the table headers below? Are these correct?-->
<table>
  <tr>
    <th>Microsyntax</th>
    <th>Translation</th>
  </tr>
  <tr>
    <td><code>prefix</code> and naked <code>expression</code></td>
    <td><code>[prefix]="expression"</code></td>
  </tr>
  <tr>
    <td><code>keyExp</code></td>
    <td><code>[prefixKey] "expression"
    (let-prefixKey="export")</code>
    <br />
    Notice that the <code>prefix</code>
    is added to the <code>key</code>
    </td>
  </tr>
  <tr>
    <td><code>let</code></td>
    <td><code>let-local="export"</code></td>
  </tr>
</table>

### Microsyntax examples

The following table demonstrates how Angular desugars microsyntax.

<table>
  <tr>
    <th>Microsyntax</th>
    <th>Desugared</th>
  </tr>
  <tr>
    <td><code>*ngFor="let item of [1,2,3]"</code></td>
    <td><code>&lt;ng-template ngFor let-item [ngForOf]="[1,2,3]"&gt;</code></td>
  </tr>
  <tr>
    <td><code>*ngFor="let item of [1,2,3] as items; trackBy: myTrack; index as i"</code></td>
    <td><code>&lt;ng-template ngFor let-item [ngForOf]="[1,2,3]" let-items="ngForOf" [ngForTrackBy]="myTrack" let-i="index"&gt;</code>
    </td>
  </tr>
  <tr>
    <td><code>*ngIf="exp"</code></td>
    <td><code>&lt;ng-template [ngIf]="exp"&gt;</code></td>
  </tr>
  <tr>
    <td><code>*ngIf="exp as value"</code></td>
    <td><code>&lt;ng-template [ngIf]="exp" let-value="ngIf"&gt;</code></td>
  </tr>
</table>

Studying the
[source code for `NgIf`](https://github.com/angular/angular/blob/master/packages/common/src/directives/ng_if.ts "Source: NgIf")
and [`NgForOf`](https://github.com/angular/angular/blob/master/packages/common/src/directives/ng_for_of.ts "Source: NgForOf")
is a great way to learn more.


{@a template-input-variable}


{@a template-input-variables}


## Template input variable

A _template input variable_ is a variable whose value you can reference _within_ a single instance of the template.
There are several such variables in this example: `hero`, `i`, and `odd`.
All are preceded by the keyword `let`.

A _template input variable_ is **_not_** the same as a
[template _reference_ variable](guide/template-reference-variables),
neither _semantically_ nor _syntactically_.

You declare a template _input_ variable using the `let` keyword (`let hero`).
The variable's scope is limited to a _single instance_ of the repeated template.
You can use the same variable name again in the definition of other structural directives.

You declare a template _reference_ variable by prefixing the variable name with `#` (`#var`).
A _reference_ variable refers to its attached element, component or directive.
It can be accessed _anywhere_ in the _entire template_.

Template _input_ and _reference_ variable names have their own namespaces. The `hero` in `let hero` is never the same
variable as the `hero` declared as `#hero`.


{@a one-per-element}


## One structural directive per host element

Someday you'll want to repeat a block of HTML but only when a particular condition is true.
You'll _try_ to put both an `*ngFor` and an `*ngIf` on the same host element.
Angular won't let you. You may apply only one _structural_ directive to an element.

The reason is simplicity. Structural directives can do complex things with the host element and its descendents.
When two directives lay claim to the same host element, which one takes precedence?
Which should go first, the `NgIf` or the `NgFor`? Can the `NgIf` cancel the effect of the `NgFor`?
If so (and it seems like it should be so), how should Angular generalize the ability to cancel for other structural directives?

There are no easy answers to these questions. Prohibiting multiple structural directives makes them moot.
There's an easy solution for this use case: put the `*ngIf` on a container element that wraps the `*ngFor` element.
One or both elements can be an [`ng-container`](guide/structural-directives#ngcontainer) so you don't have to introduce extra levels of HTML.


{@a ngSwitch}



## Inside _NgSwitch_ directives

The Angular _NgSwitch_ is actually a set of cooperating directives: `NgSwitch`, `NgSwitchCase`, and `NgSwitchDefault`.

Here's an example.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngswitch)" region="ngswitch"></code-example>



The switch value assigned to `NgSwitch` (`hero.emotion`) determines which
(if any) of the switch cases are displayed.

`NgSwitch` itself is not a structural directive.
It's an _attribute_ directive that controls the behavior of the other two switch directives.
That's why you write `[ngSwitch]`, never `*ngSwitch`.

`NgSwitchCase` and `NgSwitchDefault` _are_ structural directives.
You attach them to elements using the asterisk (*) prefix notation.
An `NgSwitchCase` displays its host element when its value matches the switch value.
The `NgSwitchDefault` displays its host element when no sibling `NgSwitchCase` matches the switch value.


<div class="alert is-helpful">



The element to which you apply a directive is its _host_ element.
The `<happy-hero>` is the host element for the happy `*ngSwitchCase`.
The `<unknown-hero>` is the host element for the `*ngSwitchDefault`.


</div>



As with other structural directives, the `NgSwitchCase` and `NgSwitchDefault`
can be desugared into the `<ng-template>` element form.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngswitch-template)" region="ngswitch-template"></code-example>



{@a prefer-asterisk}


## Prefer the asterisk (*) syntax.

The asterisk (*) syntax is more clear than the desugared form.
Use [&lt;ng-container&gt;](guide/structural-directives#ng-container) when there's no single element
to host the directive.

While there's rarely a good reason to apply a structural directive in template _attribute_ or _element_ form,
it's still important to know that Angular creates a `<ng-template>` and to understand how it works.
You'll refer to the `<ng-template>` when you [write your own structural directive](guide/structural-directives#unless).


{@a template}



## The *&lt;ng-template&gt;*

The &lt;ng-template&gt; is an Angular element for rendering HTML.
It is never displayed directly.
In fact, before rendering the view, Angular _replaces_ the `<ng-template>` and its contents with a comment.

If there is no structural directive and you merely wrap some elements in a `<ng-template>`,
those elements disappear.
That's the fate of the middle "Hip!" in the phrase "Hip! Hip! Hooray!".


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (template-tag)" region="template-tag"></code-example>



Angular erases the middle "Hip!", leaving the cheer a bit less enthusiastic.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/template-rendering.png' alt="template tag rendering">
</div>



A structural directive puts a `<ng-template>` to work
as you'll see when you [write your own structural directive](guide/structural-directives#unless).


{@a ngcontainer}


{@a ng-container}



## Group sibling elements with &lt;ng-container&gt;

There's often a _root_ element that can and should host the structural directive.
The list element (`<li>`) is a typical host element of an `NgFor` repeater.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngfor-li)" region="ngfor-li"></code-example>



When there isn't a host element, you can usually wrap the content in a native HTML container element,
such as a `<div>`, and attach the directive to that wrapper.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngif)" region="ngif"></code-example>



Introducing another container element&mdash;typically a `<span>` or `<div>`&mdash;to
group the elements under a single _root_ is usually harmless.
_Usually_ ... but not _always_.

The grouping element may break the template appearance because CSS styles
neither expect nor accommodate the new layout.
For example, suppose you have the following paragraph layout.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngif-span)" region="ngif-span"></code-example>



You also have a CSS style rule that happens to apply to a `<span>` within a `<p>`aragraph.


<code-example path="structural-directives/src/app/app.component.css" header="src/app/app.component.css (p-span)" region="p-span"></code-example>



The constructed paragraph renders strangely.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/bad-paragraph.png' alt="spanned paragraph with bad style">
</div>



The `p span` style, intended for use elsewhere, was inadvertently applied here.

Another problem: some HTML elements require all immediate children to be of a specific type.
For example, the `<select>` element requires `<option>` children.
You can't wrap the _options_ in a conditional `<div>` or a `<span>`.

When you try this,


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (select-span)" region="select-span"></code-example>



the drop down is empty.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/bad-select.png' alt="spanned options don't work">
</div>



The browser won't display an `<option>` within a `<span>`.

### &lt;ng-container&gt; to the rescue

The Angular `<ng-container>` is a grouping element that doesn't interfere with styles or layout
because Angular _doesn't put it in the DOM_.

Here's the conditional paragraph again, this time using `<ng-container>`.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (ngif-ngcontainer)" region="ngif-ngcontainer"></code-example>



It renders properly.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/good-paragraph.png' alt="ngcontainer paragraph with proper style">
</div>



Now conditionally exclude a _select_ `<option>` with `<ng-container>`.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (select-ngcontainer)" region="select-ngcontainer"></code-example>



The drop down works properly.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/select-ngcontainer-anim.gif' alt="ngcontainer options work properly">
</div>

<div class="alert is-helpful">

**Note:** Remember that ngModel directive is defined as a part of Angular FormsModule and you need to include FormsModule in the imports: [...] section of the Angular module metadata, in which you want to use it.

</div>


The `<ng-container>` is a syntax element recognized by the Angular parser.
It's not a directive, component, class, or interface.
It's more like the curly braces in a JavaScript `if`-block:


<code-example language="javascript">
  if (someCondition) {
    statement1;
    statement2;
    statement3;
  }

</code-example>



Without those braces, JavaScript would only execute the first statement
when you intend to conditionally execute all of them as a single block.
The `<ng-container>` satisfies a similar need in Angular templates.


{@a unless}



## Write a structural directive

In this section, you write an `UnlessDirective` structural directive
that does the opposite of `NgIf`.
`NgIf` displays the template content when the condition is `true`.
`UnlessDirective` displays the content when the condition is ***false***.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (appUnless-1)" region="appUnless-1"></code-example>



Creating a directive is similar to creating a component.

* Import the `Directive` decorator (instead of the `Component` decorator).

* Import the `Input`, `TemplateRef`, and `ViewContainerRef` symbols; you'll need them for _any_ structural directive.

* Apply the decorator to the directive class.

* Set the CSS *attribute selector* that identifies the directive when applied to an element in a template.

Here's how you might begin:


<code-example path="structural-directives/src/app/unless.directive.ts" header="src/app/unless.directive.ts (skeleton)" region="skeleton"></code-example>



The directive's _selector_ is typically the directive's **attribute name** in square brackets, `[appUnless]`.
The brackets define a CSS
<a href="https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors" title="MDN: Attribute selectors">attribute selector</a>.

The directive _attribute name_ should be spelled in _lowerCamelCase_ and begin with a prefix.
Don't use `ng`. That prefix belongs to Angular.
Pick something short that fits you or your company.
In this example, the prefix is `app`.


The directive _class_ name ends in `Directive` per the [style guide](guide/styleguide#02-03 "Angular Style Guide").
Angular's own directives do not.

### _TemplateRef_ and _ViewContainerRef_

A simple structural directive like this one creates an
[_embedded view_](api/core/EmbeddedViewRef "API: EmbeddedViewRef")
from the Angular-generated `<ng-template>` and inserts that view in a
[_view container_](api/core/ViewContainerRef "API: ViewContainerRef")
adjacent to the directive's original `<p>` host element.

You'll acquire the `<ng-template>` contents with a
[`TemplateRef`](api/core/TemplateRef "API: TemplateRef")
and access the _view container_ through a
[`ViewContainerRef`](api/core/ViewContainerRef "API: ViewContainerRef").

You inject both in the directive constructor as private variables of the class.


<code-example path="structural-directives/src/app/unless.directive.ts" header="src/app/unless.directive.ts (ctor)" region="ctor"></code-example>



### The _appUnless_ property

The directive consumer expects to bind a true/false condition to `[appUnless]`.
That means the directive needs an `appUnless` property, decorated with `@Input`


<div class="alert is-helpful">



Read about `@Input` in the [`@Input()` and `@Output()` properties](guide/inputs-outputs) guide.


</div>



<code-example path="structural-directives/src/app/unless.directive.ts" header="src/app/unless.directive.ts (set)" region="set"></code-example>



Angular sets the `appUnless` property whenever the value of the condition changes.
Because the `appUnless` property does work, it needs a setter.

* If the condition is falsy and the view hasn't been created previously,
tell the _view container_ to create the _embedded view_ from the template.

* If the condition is truthy and the view is currently displayed,
clear the container which also destroys the view.

Nobody reads the `appUnless` property so it doesn't need a getter.

The completed directive code looks like this:


<code-example path="structural-directives/src/app/unless.directive.ts" header="src/app/unless.directive.ts (excerpt)" region="no-docs"></code-example>



Add this directive to the `declarations` array of the AppModule.

Then create some HTML to try it.


<code-example path="structural-directives/src/app/app.component.html" header="src/app/app.component.html (appUnless)" region="appUnless"></code-example>



When the `condition` is falsy, the top (A) paragraph appears and the bottom (B) paragraph disappears.
When the `condition` is truthy, the top (A) paragraph is removed and the bottom (B) paragraph appears.


<div class="lightbox">
  <img src='generated/images/guide/structural-directives/unless-anim.gif' alt="UnlessDirective in action">
</div>

{@a directive-type-checks}

## Improving template type checking for custom directives

You can improve template type checking for custom directives by adding template guard properties to your directive definition.
These properties help the Angular template type checker find mistakes in the template at compile time, which can avoid runtime errors those mistakes can cause.

Use the type-guard properties to inform the template type checker of an expected type, thus improving compile-time type-checking for that template.

* A property `ngTemplateGuard_(someInputProperty)` lets you specify a more accurate type for an input expression within the template.
* The `ngTemplateContextGuard` static property declares the type of the template context.

This section provides example of both kinds of type-guard property.

<div class="alert is-helpful">

   For more information, see [Template type checking guide](guide/template-typecheck "Template type-checking guide").

</div>

{@a narrowing-input-types}

### Make in-template type requirements more specific with template guards

A structural directive in a template controls whether that template is rendered at run time, based on its input expression.
To help the compiler catch template type errors, you should specify as closely as possible the required type of a directive's input expression when it occurs inside the template.

A type guard function *narrows* the expected type of an input expression to a subset of types that might be passed to the directive within the template at run time.
You can provide such a function to help the type-checker infer the proper type for the expression at compile time.

For example, the `NgIf` implementation uses type-narrowing to ensure that the
template is only instantiated if the input expression to `*ngIf` is truthy.
To provide the specific type requirement, the `NgIf` directive defines a [static property `ngTemplateGuard_ngIf: 'binding'`](api/common/NgIf#static-properties).
The `binding` value is a special case for a common kind of type-narrowing where the input expression is evaluated in order to satisfy the type requirement.

To provide a more specific type for an input expression to a directive within the template, add a `ngTemplateGuard_xx` property to the directive, where the suffix to the static property name is the `@Input` field name.
The value of the property can be either a general type-narrowing function based on its return type, or the string `"binding"` as in the case of `NgIf`.

For example, consider the following structural directive that takes the result of a template expression as an input.

<code-example language="ts" header="IfLoadedDirective">
export type Loaded<T> = { type: 'loaded', data: T };
export type Loading = { type: 'loading' };
export type LoadingState<T> = Loaded<T> | Loading;
export class IfLoadedDirective<T> {
    @Input('ifLoaded') set state(state: LoadingState<T>) {}
    static ngTemplateGuard_state<T>(dir: IfLoadedDirective<T>, expr: LoadingState<T>): expr is Loaded<T> { return true; };
}

export interface Person {
  name: string;
}

@Component({
  template: `&lt;div *ifLoaded="state">{{ state.data }}&lt;/div>`,
})
export class AppComponent {
  state: LoadingState<Person>;
}
</code-example>

In this example, the `LoadingState<T>` type permits either of two states, `Loaded<T>` or `Loading`. The expression used as the directive???s `state` input is of the umbrella type `LoadingState`, as it???s unknown what the loading state is at that point.

The `IfLoadedDirective` definition declares the static field `ngTemplateGuard_state`, which expresses the narrowing behavior.
Within the `AppComponent` template, the `*ifLoaded` structural directive should render this template only when `state` is actually `Loaded<Person>`.
The type guard allows the type checker to infer that the acceptable type of `state` within the template is a `Loaded<T>`, and further infer that `T` must be an instance of `Person`.

{@a narrowing-context-type}

### Typing the directive's context

If your structural directive provides a context to the instantiated template, you can properly type it inside the template by providing a static `ngTemplateContextGuard` function.
The following snippet shows an example of such a function.

<code-example language="ts" header="myDirective.ts">
@Directive({???})
export class ExampleDirective {
    // Make sure the template checker knows the type of the context with which the
    // template of this directive will be rendered
    static ngTemplateContextGuard(dir: ExampleDirective, ctx: unknown): ctx is ExampleContext { return true; };

    // ???
}
</code-example>



{@a summary}



## Summary

You can both try and download the source code for this guide in the <live-example></live-example>.

Here is the source from the `src/app/` folder.


<code-tabs>

  <code-pane header="app.component.ts" path="structural-directives/src/app/app.component.ts">

  </code-pane>

  <code-pane header="app.component.html" path="structural-directives/src/app/app.component.html">

  </code-pane>

  <code-pane header="app.component.css" path="structural-directives/src/app/app.component.css">

  </code-pane>

  <code-pane header="app.module.ts" path="structural-directives/src/app/app.module.ts">

  </code-pane>

  <code-pane header="hero.ts" path="structural-directives/src/app/hero.ts">

  </code-pane>

  <code-pane header="hero-switch.components.ts" path="structural-directives/src/app/hero-switch.components.ts">

  </code-pane>

  <code-pane header="unless.directive.ts" path="structural-directives/src/app/unless.directive.ts">

  </code-pane>

</code-tabs>



You learned:

* that structural directives manipulate HTML layout.
* to use [`<ng-container>`](guide/structural-directives#ngcontainer) as a grouping element when there is no suitable host element.
* that the Angular desugars [asterisk (*) syntax](guide/structural-directives#asterisk) into a `<ng-template>`.
* how that works for the `NgIf`, `NgFor` and `NgSwitch` built-in directives.
* about the [_microsyntax_](guide/structural-directives#microsyntax) that expands into a [`<ng-template>`](guide/structural-directives#template).
* to write a [custom structural directive](guide/structural-directives#unless), `UnlessDirective`.
