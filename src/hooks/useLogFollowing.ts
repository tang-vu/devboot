import { useLayoutEffect, useRef, useState } from 'react';
import type { LogRecord } from '../types';

interface Anchor { id: string; offset: number }

// The view owns only its reading position. Records keep flowing through the
// existing bounded history, including while following is paused.
export function useLogFollowing(records: LogRecord[], sessionId: string | null) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followingRef = useRef(true);
    const anchorRef = useRef<Anchor | null>(null);
    const geometryRef = useRef({ height: 0, width: 0, viewport: 0 });
    const [following, setFollowing] = useState(true);
    const [historyUnavailable, setHistoryUnavailable] = useState(false);

    const rememberGeometry = () => {
        const body = bodyRef.current;
        if (body) geometryRef.current = {
            height: body.scrollHeight, width: body.clientWidth, viewport: body.clientHeight,
        };
    };
    const captureAnchor = () => {
        const body = bodyRef.current;
        if (!body) return;
        const lines = body.querySelectorAll<HTMLElement>('[data-log-id]');
        const top = body.getBoundingClientRect().top + body.clientTop;
        let low = 0;
        let high = lines.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (lines[middle].getBoundingClientRect().bottom <= top) low = middle + 1;
            else high = middle;
        }
        const line = lines[low];
        anchorRef.current = line ? { id: line.dataset.logId!, offset: line.getBoundingClientRect().top - top } : null;
    };
    const synchronize = () => {
        const body = bodyRef.current;
        if (!body) return;
        if (followingRef.current) {
            // Instant positioning avoids overlapping animations during bursts.
            body.scrollTop = body.scrollHeight;
        } else if (anchorRef.current) {
            const lines = body.querySelectorAll<HTMLElement>('[data-log-id]');
            const anchor = anchorRef.current;
            const line = Array.from(lines).find(item => item.dataset.logId === anchor.id);
            if (line) {
                const top = body.getBoundingClientRect().top + body.clientTop;
                const bounds = line.getBoundingClientRect();
                // Widening a wrapped row may remove the text position that was
                // at the top. Keep that record visible instead of scrolling
                // beyond it using an offset larger than its new height.
                const offset = anchor.offset <= -bounds.height ? 0 : anchor.offset;
                body.scrollTop += bounds.top - top - offset;
                captureAnchor();
            } else {
                // Clear, retention, or session replacement removed the reader's
                // anchor. Keep paused and make the limit visible instead of
                // pretending the previous record is still available.
                body.scrollTop = 0;
                setHistoryUnavailable(true);
                captureAnchor();
            }
        } else {
            // A paused empty view can receive its first retained records.
            captureAnchor();
        }
        rememberGeometry();
    };

    useLayoutEffect(synchronize, [records, sessionId]);
    useLayoutEffect(() => {
        const body = bodyRef.current;
        const content = contentRef.current;
        if (!body || !content || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(synchronize);
        observer.observe(body);
        observer.observe(content);
        return () => observer.disconnect();
    }, []);

    const pause = () => {
        if (!followingRef.current) return;
        captureAnchor();
        followingRef.current = false;
        setFollowing(false);
    };
    const resume = () => {
        followingRef.current = true;
        anchorRef.current = null;
        setFollowing(true);
        setHistoryUnavailable(false);
        synchronize();
    };
    const onScroll = () => {
        const body = bodyRef.current;
        if (!body) return;
        const geometry = geometryRef.current;
        if (geometry.height !== body.scrollHeight || geometry.width !== body.clientWidth
            || geometry.viewport !== body.clientHeight) {
            synchronize();
            return;
        }
        if (followingRef.current && body.scrollHeight - body.clientHeight - body.scrollTop > 2) pause();
        if (!followingRef.current) captureAnchor();
    };

    return { bodyRef, contentRef, following, historyUnavailable, pause, resume, onScroll };
}
