/** Restrict document cloning to an isolated capture root and its resources. */
export function createCaptureScopeFilter(target: Element): (element: Element) => boolean {
	const doc = target.ownerDocument;
	const keep = new Set<Element>();
	// Styles may be injected inside the application body. SVG definitions may
	// be referenced by URL from a different subtree. Keep both and their paths.
	for (const resource of doc.querySelectorAll('style, link[rel="stylesheet"], svg defs')) {
		keep.add(resource);
		for (const child of resource.querySelectorAll('*')) {
			keep.add(child);
		}
		for (let parent = resource.parentElement; parent; parent = parent.parentElement) {
			keep.add(parent);
		}
	}
	return (element) =>
		!target.contains(element) &&
		!element.contains(target) &&
		!doc.head?.contains(element) &&
		!keep.has(element);
}
