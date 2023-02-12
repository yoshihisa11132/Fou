import { VNode, defineComponent, h } from 'vue';
import * as foundkey from 'foundkey-js';
import { markdownToDom } from '@/scripts/markdown';
import { host } from '@/config';
import MkMention from '@/components/mention.vue';
import MkSparkle from '@/components/sparkle.vue';
import MkEmoji from '@/components/global/emoji.vue';

export const Markdown = defineComponent({
	props: {
		text: {
			type: String,
			required: true,
		},
		author: Object, // foundkey.entities.User
		customEmojis: Array, // foundkey.entities.CustomEmoji[]
		isNote: Boolean,
	},

	render() {
		if (!this.text) return;
		const dom = markdownToDom(this.text);

		const mapNodes = (nodes: NodeList): (VNode | string)[] => Array.from(nodes).map(mapNode);

		const mapNode = (node: Node): VNode | string => {
			switch (node.nodeName) {
				case '#text':
					return node.textContent;
				case 'SPAN':
					if (node.classList.contains('mfm-sparkle')) {
						return h(MkSparkle, {}, mapNodes(node.childNodes));
					} else if (node.classList.contains('mfm-mention')) {
						return h(MkMention, {
							username: node.querySelector('.mfm-user').textContent,
							host: node.querySelector('.mfm-host')?.textContent ?? this.author?.host ?? host,
						});
					} else if (node.classList.contains('mfm-emoji')) {
						return h(MkEmoji, { emoji: node.textContent, customEmojis: this.customEmojis });
					}
					// fallthrough, just handle like ordinary nodes
				default:
					const attrs = Array.from(node.attributes)
						.reduce((acc, {name, value}) => {
							acc[name] = value;
							return acc;
						}, {});
					return h(node.nodeName, attrs, mapNodes(node.childNodes));
			}
		};

		return h(
			'span',
			{ class: 'markdown-container' },
			mapNodes(dom.childNodes)
		);
	},
});
