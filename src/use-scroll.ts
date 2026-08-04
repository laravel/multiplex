import { useCallback, useEffect, useRef, useState } from "react";

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
        setScrollOffset((prev) => {
            if (prev === null) {
                return null;
            }

            const maxOffset = Math.max(0, totalLinesRef.current - outputHeight);
            const newOffset = prev + 1;

            return newOffset >= maxOffset ? null : newOffset;
        });
    }, [outputHeight]);

    const scrollUp = useCallback(() => {
        setScrollOffset((prev) => {
            const currentStart =
                prev ?? Math.max(0, totalLinesRef.current - outputHeight);

            return Math.max(0, currentStart - 1);
        });
    }, [outputHeight]);

    const pageDown = useCallback(() => {
        setScrollOffset((prev) => {
            if (prev === null) {
                return null;
            }

            const maxOffset = Math.max(0, totalLinesRef.current - outputHeight);
            const newOffset = prev + outputHeight;

            return newOffset >= maxOffset ? null : newOffset;
        });
    }, [outputHeight]);

    const pageUp = useCallback(() => {
        setScrollOffset((prev) => {
            const currentStart =
                prev ?? Math.max(0, totalLinesRef.current - outputHeight);
            return Math.max(0, currentStart - outputHeight);
        });
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
