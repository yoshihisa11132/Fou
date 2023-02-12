import { VNode, defineComponent, h } from 'vue';
import * as mfm from 'mfm-js';
import MkUrl from '@/components/global/url.vue';
import MkLink from '@/components/link.vue';
import MkMention from '@/components/mention.vue';
import MkEmoji from '@/components/global/emoji.vue';
import MkFormula from '@/components/formula.vue';
import MkCode from '@/components/code.vue';
import MkSearch from '@/components/mfm-search.vue';
import MkSparkle from '@/components/sparkle.vue';
import MkA from '@/components/global/a.vue';
import { host } from '@/config';

export default defineComponent({
	props: {
		text: {
			type: String,
			required: true,
		},
		plain: {
			type: Boolean,
			default: false,
		},
		nowrap: {
			type: Boolean,
			default: false,
		},
		author: {
			type: Object,
			default: null,
		},
		customEmojis: {
			required: false,
		},
		isNote: {
			type: Boolean,
			default: true,
		},
	},

	render() {
		if (this.text == null || this.text === '') return;

		const ast = (this.plain ? mfm.parseSimple : mfm.parse)(this.text);

		const validTime = (t: string | true) => {
			if (typeof t !== 'string') return null;
			return t.match(/^[0-9.]+m?s$/) ? t : null;
		};

		const genEl = (ast: mfm.MfmNode[]) => ast.map((token): VNode | VNode[] => {
			switch (token.type) {
				case 'text': {
					const text = token.props.text.replace(/(\r\n|\n|\r)/g, '\n');

					if (!this.plain) {
						const res: VNode[] = [];
						for (const t of text.split('\n')) {
							res.push(h('br'));
							res.push(t);
						}
						res.shift();
						return res;
					} else {
						return text.replace(/\n/g, ' ');
					}
				}

				case 'bold': {
					return h('b', genEl(token.children));
				}

				case 'strike': {
					return h('del', genEl(token.children));
				}

				case 'italic': {
					return h('i', {
						style: 'font-style: oblique;',
					}, genEl(token.children));
				}

				case 'fn': {
					const attributes = Object.keys(token.props.args).reduce((acc, x) => {
						if (!['deg', 'speed', 'color'].includes(x)) acc['data-mfm-' + x] = true;
						return acc;
					}, {});
					switch (token.props.name) {
						case 'sparkle': {
							if (!this.$store.state.animatedMfm) {
								return genEl(token.children);
							}
							return h(MkSparkle, {}, genEl(token.children));
						}
						case 'position': {
							const x = parseFloat(token.props.args.x ?? '0');
							const y = parseFloat(token.props.args.y ?? '0');
							attributes.style = `transform: translate(${x}em, ${y}em);`;
							break;
						}
						case 'scale': {
							const x = Math.min(parseFloat(token.props.args.x ?? '1'), 5);
							const y = Math.min(parseFloat(token.props.args.y ?? '1'), 5);
							attributes.style = `transform: scale(${x}, ${y});`;
							break;
						}
						case 'fg': {
							let color = token.props.args.color ?? 'f00';
							if (!/^([0-9a-f]{3}){1,2}$/i.test(color)) color = 'f00';
							attributes.style = `color: #${color};`;
							break;
						}
						case 'bg': {
							let color = token.props.args.color ?? '0f0';
							if (!/^([0-9a-f]{3}){1,2}$/i.test(color)) color = '0f0';
							attributes.style = `background-color: #${color};`;
							break;
						}
						case 'bounce':
						case 'jelly':
						case 'jump':
						case 'rainbow':
						case 'shake':
						case 'spin':
						case 'tada':
						case 'twitch':
							if (token.props.args.speed) {
								attributes.style = '--mfm-speed: ' + validTime(token.props.args.speed);
							}
							break;
						case 'rotate':
							if (!isNaN(parseInt(token.props.args.deg))) {
								attributes.style = '--mfm-deg: ' + parseInt(token.props.args.deg);
							}
							break;
					}
					return h('span', {
						class: 'mfm-' + token.props.name,
						...attributes,
					}, genEl(token.children));
				}

				case 'small': {
					return h('small', {
						class: '_mfm_small_'
					}, genEl(token.children));
				}

				case 'center': {
					return h('span', {
						class: 'mfm-center',
					}, genEl(token.children));
				}

				case 'url': {
					return h(MkUrl, {
						key: Math.random(),
						url: token.props.url,
						rel: 'nofollow noopener',
					});
				}

				case 'link': {
					return h(MkLink, {
						key: Math.random(),
						url: token.props.url,
						rel: 'nofollow noopener',
					}, genEl(token.children));
				}

				case 'mention': {
					return h(MkMention, {
						key: Math.random(),
						host: (token.props.host == null && this.author && this.author.host != null ? this.author.host : token.props.host) || host,
						username: token.props.username,
					});
				}

				case 'hashtag': {
					return h(MkA, {
						key: Math.random(),
						to: this.isNote ? `/tags/${encodeURIComponent(token.props.hashtag)}` : `/explore/tags/${encodeURIComponent(token.props.hashtag)}`,
						style: 'color:var(--hashtag);',
					}, `#${token.props.hashtag}`);
				}

				case 'blockCode': {
					return h(MkCode, {
						key: Math.random(),
						code: token.props.code,
						lang: token.props.lang,
					});
				}

				case 'inlineCode': {
					return h(MkCode, {
						key: Math.random(),
						code: token.props.code,
						inline: true,
					});
				}

				case 'quote': {
					return h(this.nowrap ? 'span' : 'div', {
						class: 'quote',
					}, genEl(token.children));
				}

				case 'emojiCode': {
					return h(MkEmoji, {
						key: Math.random(),
						emoji: `:${token.props.name}:`,
						customEmojis: this.customEmojis,
						normal: this.plain,
					});
				}

				case 'unicodeEmoji': {
					return h(MkEmoji, {
						key: Math.random(),
						emoji: token.props.emoji,
						customEmojis: this.customEmojis,
						normal: this.plain,
					});
				}

				case 'mathInline': {
					return h(MkFormula, {
						key: Math.random(),
						formula: token.props.formula,
						block: false,
					});
				}

				case 'mathBlock': {
					return h(MkFormula, {
						key: Math.random(),
						formula: token.props.formula,
						block: true,
					});
				}

				case 'search': {
					return h(MkSearch, {
						key: Math.random(),
						q: token.props.query,
					});
				}

				default: {
					console.error('unrecognized ast type:', token.type);

					return [];
				}
			}
		}).flat();

		// Parse ast to DOM
		return h('span', {
			class: this.$store.state.animatedMfm ? 'animated-mfm' : '',
		}, genEl(ast));
	},
});
