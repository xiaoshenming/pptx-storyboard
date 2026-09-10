export function storyboardStaticMode(search = window.location.search): boolean {
	return new URLSearchParams(search).get('storyboardMode') === 'static';
}
