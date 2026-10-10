import { describe, expect, it } from 'vitest';
import { h, toHtml } from './markup.ts';

describe('toHtml', () => {
  it('writes words as text, never as markup', () => {
    const markup = h('p', { class: 'a "b"', text: '<script>alert("&")</script>' });
    expect(toHtml(markup)).toBe(
      '<p class="a &quot;b&quot;">&lt;script&gt;alert(&quot;&amp;&quot;)&lt;/script&gt;</p>',
    );
  });

  it('nests children after the text and leaves out what is not there', () => {
    const markup = h('ul', { attrs: { 'aria-label': 'Tags' } }, [
      h('li', { text: 'C++' }),
      null,
      false,
      undefined,
      'and more',
    ]);
    expect(toHtml(markup)).toBe('<ul aria-label="Tags"><li>C++</li>and more</ul>');
  });

  it('closes no void element', () => {
    expect(toHtml(h('img', { attrs: { src: '/a.webp', alt: 'A & B' } }))).toBe(
      '<img src="/a.webp" alt="A &amp; B">',
    );
    expect(() => toHtml(h('img', { text: 'no' }))).toThrow();
  });
});
