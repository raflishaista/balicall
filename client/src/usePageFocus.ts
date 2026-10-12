import {useEffect} from 'react';
import type {RefObject} from 'react';

export function usePageFocus(page: string, target: RefObject<HTMLElement|null>) {
  useEffect(() => {
    // Navigation announces the new content; unrelated updates do not move focus.
    // A modal already in the top layer keeps ownership of keyboard focus.
    if (!document.querySelector('dialog[open]')) target.current?.focus();
  }, [page, target]);
}
