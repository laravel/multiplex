import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pure scroll transitions, factored out so the clamping is unit-testable
 * without rendering anything. `null` means pinned to the live tail.
 */
export function nextScrollDown(
    prev: number | null,
    totalLines: number,
    outputHeight: number,
): number | null {
    if (prev === null) {
        return null;
    }

    const maxOffset = Math.max(0, totalLines - outputHeight);
    const newOffset = prev + 1;

    return newOffset >= maxOffset ? null : newOffset;
}

export function nextScrollUp(
    prev: number | null,
    totalLines: number,
    outputHeight: number,
): number {
    const currentStart = prev ?? Math.max(0, totalLines - outputHeight);

    return Math.max(0, currentStart - 1);
}

export function nextPageDown(
    prev: number | null,
    totalLines: number,
    outputHeight: number,
): number | null {
    if (prev === null) {
        return null;
    }

    const maxOffset = Math.max(0, totalLines - outputHeight);
    const newOffset = prev + outputHeight;

    return newOffset >= maxOffset ? null : newOffset;
}

export function nextPageUp(
    prev: number | null,
    totalLines: number,
    outputHeight: number,
): number {
    const currentStart = prev ?? Math.max(0, totalLines - outputHeight);

    return Math.max(0, currentStart - outputHeight);
}

export function useScroll(outputHeight: number) {
    const [scrollOffset, setScrollOffset] = useState<number | null>(null);
    const [hasNewOutput, setHasNewOutput] = useState(false);
    const totalLinesRef = useRef(0);
    const scrollOffsetRef = useRef<number | null>(null);

    scrollOffsetRef.current = scrollOffset;

    useEffect(() => {
        if (scrollOffset === null) {
            setHasNewOutput(false);
        }
    }, [scrollOffset]);

    const notifyNewOutput = useCallback(() => {
        if (scrollOffsetRef.current !== null) {
            setHasNewOutput(true);
        }
    }, []);

    const scrollDown = useCallback(() => {
        setScrollOffset((prev) =>
            nextScrollDown(prev, totalLinesRef.current, outputHeight),
        );
    }, [outputHeight]);

    const scrollUp = useCallback(() => {
        setScrollOffset((prev) =>
            nextScrollUp(prev, totalLinesRef.current, outputHeight),
        );
    }, [outputHeight]);

    const pageDown = useCallback(() => {
        setScrollOffset((prev) =>
            nextPageDown(prev, totalLinesRef.current, outputHeight),
        );
    }, [outputHeight]);

    const pageUp = useCallback(() => {
        setScrollOffset((prev) =>
            nextPageUp(prev, totalLinesRef.current, outputHeight),
        );
    }, [outputHeight]);

    const scrollToTop = useCallback(() => {
        setScrollOffset(0);
    }, []);

    const scrollToBottom = useCallback(() => {
        setScrollOffset(null);
        setHasNewOutput(false);
    }, []);

    const resetScroll = useCallback(() => {
        setScrollOffset(null);
    }, []);

    return {
        scrollOffset,
        hasNewOutput,
        totalLinesRef,
        notifyNewOutput,
        scrollDown,
        scrollUp,
        pageDown,
        pageUp,
        scrollToTop,
        scrollToBottom,
        resetScroll,
    };
}
