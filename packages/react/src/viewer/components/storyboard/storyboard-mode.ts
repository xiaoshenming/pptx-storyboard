export function storyboardStaticMode(search = window.location.search): boolean {
	return new URLSearchParams(search).get('storyboardMode') === 'static';
}

export function storyboardSlideSelection(search = window.location.search): Set<number> | undefined {
	const raw = new URLSearchParams(search).get('storyboardSlides');
	if (!raw) {
		return undefined;
	}
	const slides = raw
		.split(',')
		.map(Number)
		.filter((value) => Number.isSafeInteger(value) && value > 0);
	return slides.length ? new Set(slides) : undefined;
}
