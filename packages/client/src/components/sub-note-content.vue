<template>
<div class="wrmlmaau" :class="{ collapsed, isLong }">
	<div class="body">
		<span v-if="note.deletedAt" style="opacity: 0.5">({{ i18n.ts.deleted }})</span>
		<MkA v-if="note.replyId" class="reply" :to="`/notes/${note.replyId}`"><i class="fas fa-reply"></i></MkA>
		<Mfm v-if="note.text" :text="note.text" :author="note.user" :custom-emojis="note.emojis"/>
		<MkA v-if="note.renoteId" class="rp" :to="`/notes/${note.renoteId}`">RN: ...</MkA>
	</div>
	<details v-if="note.files.length > 0">
		<summary>({{ i18n.t('withNFiles', { n: note.files.length }) }})</summary>
		<XMediaList :media-list="note.files"/>
	</details>
	<details v-if="note.poll">
		<summary>{{ i18n.ts.poll }}</summary>
		<XPoll :note="note"/>
	</details>
	<button v-if="isLong && collapsed" class="fade _button" @click="collapsed = false">
		<span>{{ i18n.ts.showMore }}</span>
	</button>
	<button v-if="isLong && !collapsed" class="showLess _button" @click="collapsed = true">
		<span>{{ i18n.ts.showLess }}</span>
	</button>
</div>
</template>

<script lang="ts" setup>
import * as foundkey from 'foundkey-js';
import XPoll from './poll.vue';
import XMediaList from './media-list.vue';
import { i18n } from '@/i18n';

const props = defineProps<{
	note: foundkey.entities.Note;
}>();

const isLong = (
	props.note.cw == null && props.note.text != null && (
		(props.note.text.split('\n').length > 9) ||
		(props.note.text.length > 500)
	)
);
const collapsed = $ref(props.note.cw == null && isLong);
</script>

<style lang="scss" scoped>
.wrmlmaau {
	overflow-wrap: break-word;

	> .body {
		> .reply {
			margin-right: 6px;
			color: var(--accent);
		}

		> .rp {
			margin-left: 4px;
			font-style: oblique;
			color: var(--renote);
		}
	}

	&.collapsed {
		position: relative;
		max-height: 9em;
		overflow: hidden;

		> .fade {
			display: block;
			position: absolute;
			bottom: 0;
			left: 0;
			width: 100%;
			height: 64px;
			background: linear-gradient(0deg, var(--panel), var(--X15));

			> span {
				display: inline-block;
				background: var(--panel);
				padding: 6px 10px;
				font-size: 0.8em;
				border-radius: 999px;
				box-shadow: 0 2px 6px rgb(0 0 0 / 20%);
			}

			&:hover {
				> span {
					background: var(--panelHighlight);
				}
			}
		}
	}

	&.isLong {
		> .showLess {
			width: 100%;
			margin-top: 1em;
			position: sticky;
			bottom: 1em;

			> span {
				display: inline-block;
				background: var(--panel);
				padding: 6px 10px;
				font-size: 0.8em;
				border-radius: 999px;
				box-shadow: 0 0 7px 7px var(--bg);
			}
		}
	}
}
</style>
