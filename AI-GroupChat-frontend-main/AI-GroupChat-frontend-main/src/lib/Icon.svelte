<script lang="ts">
	// Lucide icon paths (lucide.dev, ISC licence), inlined to avoid a dependency for a handful of icons.
	const paths: Record<string, string> = {
		'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
		send: '<path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"/><path d="M6 12h16"/>',
		'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
		square: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
		gavel: '<path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
		plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
		messages: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
		'skip-forward': '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
		check: '<path d="M20 6 9 17l-5-5"/>',
		radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
		workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
		'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
		// Persona emblems (custom), keyed by persona id.
		stoic: '<path d="M3 5.5 12 2l9 3.5"/><path d="M4 7.5h16"/><path d="M6.5 10v8M10.5 10v8M13.5 10v8M17.5 10v8"/><path d="M4 20.5h16"/>', // temple column
		existentialist: '<path d="M12 2.5c1.2 3.2 5.5 5.3 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1.1-4 2.3-5 0 2.2 1 3.4 2.2 3.4 0-3.3-1.1-5.6 1-8.9z"/>', // flame of choice
		buddhist: '<path d="M18.9 8.6A7.8 7.8 0 1 1 13.8 4.4"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>', // enso
		pragmatist: '<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.4 5.2-5.2 2.4 2.4-5.2z"/>', // compass
		rationalist: '<circle cx="12" cy="12" r="9"/><path d="M12 3 19.8 16.5H4.2z"/><circle cx="12" cy="12" r="1" fill="currentColor"/>', // inscribed geometry
		absurdist: '<path d="M2 20.5h20"/><path d="M3 20.5 12 6l9 14.5"/><circle cx="7.1" cy="9" r="2.6"/>', // boulder near the summit
		moderator: '<path d="M12 3v17"/><path d="M8 20.5h8"/><path d="M4.5 6.5h15"/><path d="M4.5 6.5 2 12.5a2.6 2.6 0 0 0 5 0z"/><path d="M19.5 6.5 17 12.5a2.6 2.6 0 0 0 5 0z"/>' // scales
	};
	export let name: keyof typeof paths;
	export let size = 16;
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	class="icon">{@html paths[name]}</svg
>

<style>
	.icon { flex-shrink: 0; }
</style>
