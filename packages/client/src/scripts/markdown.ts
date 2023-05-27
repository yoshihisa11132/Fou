import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import * as foundkey from 'foundkey-js';
import { MFM_TAGS } from '@/scripts/mfm-tags';

const sanitizerOptions = {
	allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "dd", "dl", "dt", "hr", "li", "ol", "p", "pre", "ul", "a", "b", "br", "code", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "small", "span", "strong", "sub", "sup", "u", "wbr", "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "img", "del"],
	allowedAttributes: {
		a: [ 'href', 'name', 'target' ],
		img: [ 'src', 'srcset', 'alt', 'title', 'width', 'height', 'loading' ],
		span: [ 'class', 'style', 'data-mfm-*' ],
	},
	allowedClasses: {
		span: [ /^mfm-/ ],
	},
	allowedStyles: {
		span: {
			'--mfm-speed': [/^\d*\.?\d+m?s$/], // decimal number (e.g. 1 or 1.0 or .1) followed by "ms" or "s"
			'--mfm-deg': [/^\d*\.?\d+$/], // decimal number
			'--mfm-x': [/^\d*\.?\d+$/], // decimal number
			'--mfm-y': [/^\d*\.?\d+$/], // decimal number
			'--mfm-color': [/^#([0-9a-f]{3}){1,2}$/i], // CSS hex color code without alpha
		},
	},
	allowedSchemes: sanitizeHtml.defaults.allowedSchemes.concat([ 'gopher', 'gemini' ]),
	disallowedTagsMode: 'escape',
};

const inputSanitizerOptions = {
	// disallow <span>s in the input and thus try to make sure people
	// don't sneak spoofed MFM spans in, which could upset the later processing
	allowedTags: sanitizerOptions.allowedTags.filter(x => x != 'span'),
	allowedSchemes: sanitizerOptions.allowedSchemes,
	disallowedTagsMode: 'discard',
};

marked.setOptions({
	gfm: true,
	breaks: true,
	xhtml: true,
	// sanitizes the *input* HTML that is already in the markdown before
	sanitizer: (html) => sanitizeHtml(html, inputSanitizerOptions),
});
marked.use({
	tokenizer: {
		blockquote(src) {
			// custom behaviour: don't continue blockquotes onto lines that do not start with a `>`
			// but allow a single empty line to continue the quote
			const match = src.match(/^(?: {0,3}>.*(?:\r\n|\n|$){1,2})+/);
			if (!match) return;

			const lines = match[0].replaceAll('\r\n', '\n')
				.split('\n')
				.map(line => {
					if (line === '') { return line; }

					const initial = line.match(/^ {0,3}>[ \t]?/);
					return line.replace(initial[0], '');
				})
				.join('\n');

			const tokens = [];
			this.lexer.blockTokens(lines, tokens);

			return {
				type: 'blockquote',
				raw: match[0],
				text: lines,
				tokens,
			};
		},
	},
	extensions: [
		{
			name: 'center-tag',
			level: 'block',
			start(src) { return src.match(/^<center>/i)?.index; },
			tokenizer(src) {
				const match = src.match(/^<center>[\r\n]*(.*)[\r\n]*<\/center>/i);
				if (match) return {
					type: 'center-tag',
					raw: match[0],
					tokens: this.lexer.blockTokens(match[1]),
				};
			},
			renderer(token) {
				return '<span class="mfm-center">' + this.parser.parse(token.tokens) + '</span>';
			},
		},
		{
			name: 'mention',
			level: 'inline',
			start(src) { return src.match(/(?<=^|\s)@/)?.index; },
			tokenizer(src) {
				const match = src.match(/^@([-_a-z0-9]+)(?:@(\p{L}+(?:[-.]*\p{L}+)*))?/iu);
				if (!match) return;

				return {
					type: 'mention',
					raw: match[0],
					user: match[1],
					host: match.length < 2 ? null : match[2],
				};
			},
			renderer(token) {
				if (token.host) {
					return `<span class="mfm-mention">@<span class="mfm-user">${token.user}</span>@<span class="mfm-host">${token.host}</span></span>`;
				} else {
					return `<span class="mfm-mention">@<span class="mfm-user">${token.user}</span></span>`;
				}
			},
		},
		{
			name: 'custom-emoji',
			level: 'inline',
			start(src) { return src.match(/:[-a-z0-9_+]+:/i)?.index; },
			tokenizer(src) {
				const match = src.match(/^:([-a-z0-9_+]+):/i);
				if (!match) return;

				return {
					type: 'custom-emoji',
					raw: match[0],
				};
			},
			renderer(token) {
				return `<span class="mfm-emoji">${token.raw}</span>`;
			},
		},
		{
			name: 'katex-block',
			level: 'block',
			start(src) { return src.match(/^\\\[/)?.index; },
			tokenizer(src) {
				const match = src.match(/^\\\[[\r\n]*(.+?)[\r\n]*\\\]/s);
				if (!match) return;

				return {
					type: 'katex-block',
					raw: match[0],
					katex: match[1],
				};
			},
			renderer(token) {
				const elem = document.createElement('span');
				elem.classList.add('mfm-katex');
				elem.innerText = token.katex;
				return elem.outerHTML;
			},
		},
		{
			name: 'katex-inline',
			level: 'inline',
			start(src) { return src.match(/^\\\(/)?.index; },
			tokenizer(src) {
				const match = src.match(/^\\\((.+?)\\\)/);
				if (!match) return;

				return {
					type: 'katex-inline',
					raw: match[0],
					katex: match[1],
				};
			},
			renderer(token) {
				const elem = document.createElement('span');
				elem.classList.add('mfm-katex');
				elem.setAttribute('data-mfm-inline', '1');
				elem.innerText = token.katex;
				return elem.outerHTML;
			},
		},
		{
			name: 'hashtag',
			level: 'inline',
			start(src) { return src.match(/(?<=^|\p{P}|\s)#/)?.index; },
			tokenizer(src) {
				if (!src.startsWith("#")) return;

				function recognizeHashtag(src) {
					// SECURITY: these regexes must not allow any "HTML dangerous" characters.
					const ordinaries = src.match(/^[-\p{L}\p{N}\p{M}\p{Sk}\p{Pc}]*/u);
					const open = src.slice(ordinaries[0].length).match(/^[\[({「]*/);

					if (ordinaries[0].length === 0 && open[0].length === 0) {
						// end of text or hashtag
						return '';
					}

					const close = open[0].split("").map(char => {
						return {
							'[': '\\]',
							'(': '\\)',
							'{': '\\}',
							'「': '」',
						}[char];
					}).join("");
					const sub = src.slice(ordinaries[0].length).match(new RegExp(
						open[0].replaceAll(/([\[({])/g, '\\$1') // escape open brackets/parens
						+ '(.*)'
						+ close,
					'u'));
					if (!sub || sub[1] !== recognizeHashtag(sub[1])) return ordinaries[0];

					const recognized = ordinaries[0] + sub[0];
					const remainder = recognizeHashtag(src.slice(recognized.length));

					if (sub[1] === '' && remainder === '') {
						// don't recognize parens with nothing in them at the end
						return ordinaries[0];
					} else {
						return recognized + remainder;
					}
				}

				let hashtag = recognizeHashtag(src.slice(1));
				// all numeric strings cannot be hashtags
				if (hashtag.match(/^\p{N}+$/u)) return;

				return {
					type: 'hashtag',
					raw: '#' + hashtag,
					tag: hashtag.normalize('NFKC'),
				};
			},
			renderer(token) {
				// SECURITY: token.raw cannot contain "HTML dangerous" characters
				return `<a href="/explore/tags/${encodeURIComponent(token.tag)}" class="mfm-hashtag">${token.raw}</a>`;
			},
		},
		{
			name: 'mfm-function',
			level: 'inline',
			start(src) { return src.indexOf('$['); },
			tokenizer(src) {
				/*
				 * ABNF of the regex below, the regex matches the <mfm-fn> rule
				 * SECURITY: neither argument key nor value must contain any "HTML dangerous" characters

				name     = 1*(ALPHA / DIGIT / "_")                  ; one or more "word" characters, Ecmascripts \w

				argument = <name> ["=" <name>]                      ; arguments are key = value pairs

				mfm-fn   = "$[" <name>                              ; start of the function
				           ["." <argument> *("," <argument>)]       ; optionally with parameters
				            ; note that multiple arguments are separated with commas not dots
				           SP <content> "]"                         ; end of the function
				*/
				const match = src.match(/^\$\[(\w+)(\.\w+(?:=\w+)?(?:,\w+(?:=\w+)?)*)? (.+)\]/);
				if (!match || !MFM_TAGS.includes(match[1])) return;

				let args = {};
				if (match[2]) {
					// parse args
					match[2]
						// slice off the initial dot
						.slice(1)
						// split arguments by comma
						.split(',')
						// split argument name and value
						.map((arg) => {
							if (arg.includes('=')) {
								// split once at first equal sign
								const equalsIdx = arg.indexOf('=');
								const key = arg.slice(0, equalsIdx);
								let value = arg.slice(equalsIdx + 1);

								// add initial octothorpe to hex color code if necessary
								if (key === 'color' && !value.startsWith('#')) {
									value = '#' + value;
								}

								return [key, value];
							} else {
								return [arg, null];
							}
						})
						// save arguments
						.forEach(([key, val]) => args[key] = val);
				}

				const token = {
					type: 'mfm-function',
					raw: match[0],
					fn: match[1],
					args,
					tokens: [],
				};
				this.lexer.inline(match[3], token.tokens);
				return token;
			},
			renderer(token) {
				// arguments are mapped to `data-mfm-...` attributes for CSS selectors
				const argsAttrs = Object.entries(token.args)
					.reduce((acc, [key, value]) => {
						if (value == null) {
							// SECURITY: key does not need to be escaped because only "word" characters will be matched in the tokenizer
							return acc + ` data-mfm-${key}`;
						} else {
							// SECURITY: key and value do not need to be escaped because only "word" characters will be matched in the tokenizer
							return acc + ` data-mfm-${key}="${value}"`;
						}
					}, '');
				// ... and also to CSS variables so the values can be accessed in CSS
				const argsCss = Object.entries(token.args)
					.reduce((acc, [key, value]) => {
						if (value == null) {
							return acc + ` --mfm-${key}: 1;`;
						} else {
							return acc + ` --mfm-${key}: ${value};`;
						}
					}, '');

				return `<span class="mfm-${token.fn}" style="${argsCss}"${argsAttrs}>${this.parser.parseInline(token.tokens)}</span>`;
			},
		},
	],
});

export function markdownToDom(text) {
	const elem = document.createElement('span');
	elem.innerHTML = sanitizeHtml(marked(text), sanitizerOptions);
	return elem;
}
