import React, { useRef, useState } from 'react';

import { isSupportedPresentationFile } from '../../packages/shared/src/render/presentation-file-kinds';

interface Props {
	label: string;
	disabled: boolean;
	onFile: (file: File) => void;
	onClick: (event: React.MouseEvent<HTMLElement>) => void;
	children: React.ReactNode;
}

function hasFiles(data: DataTransfer): boolean {
	return Array.from(data.types).includes('Files') || data.files.length > 0;
}

/** File drags need their own state: CSS :hover does not reliably track native drags. */
export function PresentationDropzone({ label, disabled, onFile, onClick, children }: Props) {
	const depth = useRef(0);
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState('');
	const reset = () => {
		depth.current = 0;
		setDragging(false);
	};
	const onDrop = (event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		reset();
		if (disabled) {
			return;
		}
		const files = Array.from(event.dataTransfer.files);
		if (files.length !== 1) {
			setError(
				files.length
					? '一次请拖入一个演示文稿文件。'
					: '未读取到文件，请从文件夹拖入，或点击“选择文件”。',
			);
			return;
		}
		const file = files[0];
		if (!isSupportedPresentationFile(file.name)) {
			setError(`不支持“${file.name}”，请导入 PPTX、PPT 等演示文稿文件。`);
			return;
		}
		setError('');
		onFile(file);
	};
	return (
		// Drag and drop supplements the keyboard-accessible native file input.
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<div
			role='group'
			aria-label={label}
			aria-disabled={disabled}
			data-testid='dropzone'
			data-drag-active={dragging}
			className={`relative max-w-[900px] w-full border-2 border-dashed rounded-xl p-8 text-center transition-colors ${dragging ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border hover:border-primary hover:bg-accent'} ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}
			onClick={disabled ? undefined : onClick}
			onDragEnter={(event) => {
				if (!hasFiles(event.dataTransfer)) {
					return;
				}
				event.preventDefault();
				depth.current += 1;
				setDragging(true);
				setError('');
			}}
			onDragOver={(event) => {
				if (!hasFiles(event.dataTransfer)) {
					return;
				}
				event.preventDefault();
				event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
			}}
			onDragLeave={() => {
				depth.current = Math.max(0, depth.current - 1);
				if (depth.current === 0) {
					setDragging(false);
				}
			}}
			onDragEnd={reset}
			onDrop={onDrop}
		>
			{children}
			{dragging && (
				<div
					className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/95 p-6 text-lg font-semibold text-primary'
					role='status'
				>
					{disabled ? '正在处理文件，请稍候…' : '松开以导入演示文稿'}
				</div>
			)}
			{error && (
				<p role='alert' className='mt-3 text-sm text-red-500'>
					{error}
				</p>
			)}
		</div>
	);
}
