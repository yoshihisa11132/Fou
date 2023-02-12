import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import * as foundkey from 'foundkey-js';
import { MFM_TAGS } from '@/scripts/mfm-tags';

const sanitizerOptions = {
	allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "dd", "dl", "dt", "hr", "li", "ol", "p", "pre", "ul", "a", "b", "br", "code", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "small", "span", "strong", "sub", "sup", "u", "wbr", "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "img"],
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
			'--mfm-speed': [/^\d*\.?\d+m?s$/],
			'--mfm-deg': [/^\d*\.?\d+$/],
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
			start(src) { return src.match(/(^|\s)@/)?.index; },
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
								return [arg.slice(0, equalsIdx), arg.slice(equalsIdx + 1)];
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
