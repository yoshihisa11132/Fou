<template>
<XWindow ref="uiWindow" :initial-width="400" :initial-height="500" :can-resize="true" @closed="emit('closed')">
	<template #header>
		<i class="fas fa-exclamation-circle" style="margin-right: 0.5em;"></i>
		<I18n :src="i18n.ts.reportAbuseOf" tag="span">
			<template #name>
				<b><MkAcct :user="user"/></b>
			</template>
		</I18n>
	</template>
	<div class="dpvffvvy _monolithic_">
		<div class="_section">
			<FormTextarea v-model="comment">
				<template #label>{{ i18n.ts.details }}</template>
				<template #caption>{{ i18n.ts.fillAbuseReportDescription }}</template>
			</FormTextarea>
		</div>
		<div class="_section">
			<MkButton primary full :disabled="comment.length === 0" @click="send">{{ i18n.ts.send }}</MkButton>
		</div>
	</div>
</XWindow>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import * as foundkey from 'foundkey-js';
import XWindow from '@/components/ui/window.vue';
import FormTextarea from '@/components/form/textarea.vue';
import MkButton from '@/components/ui/button.vue';
import * as os from '@/os';
import { i18n } from '@/i18n';

const props = defineProps<{
	user: foundkey.entities.User;
	urls?: string[];
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const uiWindow = ref<InstanceType<typeof XWindow>>();
const comment = ref('');

function send(): void {
	os.apiWithDialog('users/report-abuse', {
		userId: props.user.id,
		urls: props.urls || [],
		comment: comment.value,
	}).then(() => {
		os.alert({
			type: 'success',
			text: i18n.ts.abuseReported,
		});
		uiWindow.value?.close();
		emit('closed');
	});
}
</script>

<style lang="scss" scoped>
.dpvffvvy {
	--root-margin: 16px;
}
</style>
