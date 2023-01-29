<template>
<!-- eslint-disable-next-line vue/no-v-html -->
<span v-html="rendered"></span>
</template>

<script lang="ts" setup>
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html';
import * as foundkey from 'foundkey-js';

const props = defineProps<{
	text: string;
	author?: foundkey.entities.User;
	customEmojis?: foundkey.entities.CustomEmoji[];
	isNote?: boolean;
}>();

// TODO use extensions
// marked.use(...);

const rendered = sanitizeHtml(marked(props.text), {
	allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img' ]),
	allowedAttributes: {
		a: [ 'href', 'name', 'target' ],
		img: [ 'src', 'srcset', 'alt', 'title', 'width', 'height', 'loading' ],
		span: [ 'class', 'data-*' ],
	},
	allowedSchemes: sanitizeHtml.defaults.allowedSchemes.concat([ 'gopher', 'gemini' ]),
	disallowedTagsMode: 'escape',
});
</script>
