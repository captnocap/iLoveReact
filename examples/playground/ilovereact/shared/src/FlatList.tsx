/**
 * FlatList -- virtualized scrollable list component
 *
 * Renders only items visible within the scroll viewport plus a configurable
 * buffer zone (windowSize). Uses spacer elements above and below the visible
 * window to maintain correct total scroll height without mounting every item.
 *
 * Works in both web mode (DOM) and native mode (Love2D via react-reconciler)
 * by delegating all scrolling to the existing ScrollView component.
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import { ScrollView } from './ScrollView';
import { Box } from './primitives';
import type {
  FlatListProps,
  FlatListRef,
  ScrollViewRef,
  ScrollEvent,
  Style,
} from './types';

// ── Defaults ────────────────────────────────────────────

const DEFAULT_INITIAL_NUM_TO_RENDER = 10;
const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_MAX_TO_RENDER_PER_BATCH = 10;
const DEFAULT_ON_END_REACHED_THRESHOLD = 0.5;
const DEFAULT_ESTIMATED_ITEM_SIZE = 50;

// ── Helpers ─────────────────────────────────────────────

function defaultKeyExtractor(_item: unknown, index: number): string {
  return String(index);
}

/**
 * Compute the visible item range given scroll position and container size.
 * Returns [startIndex, endIndex] (inclusive).
 */
function computeVisibleRange(
  scrollOffset: number,
  containerSize: number,
  itemSize: number,
  itemCount: number,
  windowSize: number,
): [number, number] {
  if (itemCount === 0 || itemSize <= 0) return [0, 0];

  // The number of items that fit in one viewport
  const viewportItems = Math.ceil(containerSize / itemSize);

  // Buffer: (windowSize - 1) / 2 viewports on each side
  const bufferViewports = (windowSize - 1) / 2;
  const bufferItems = Math.ceil(bufferViewports * viewportItems);

  // First visible item (without buffer)
  const firstVisible = Math.floor(scrollOffset / itemSize);

  const start = Math.max(0, firstVisible - bufferItems);
  const end = Math.min(itemCount - 1, firstVisible + viewportItems + bufferItems);

  return [start, end];
}

// ── FlatList ────────────────────────────────────────────

function FlatListInner<T>(
  props: FlatListProps<T>,
  ref: React.Ref<FlatListRef>,
) {
  const {
    data,
    renderItem,
    keyExtractor = defaultKeyExtractor,
    horizontal = false,
    itemHeight,
    itemWidth,
    estimatedItemSize = DEFAULT_ESTIMATED_ITEM_SIZE,
    onEndReached,
    onEndReachedThreshold = DEFAULT_ON_END_REACHED_THRESHOLD,
    onScroll: onScrollProp,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    ItemSeparatorComponent,
    style,
    contentContainerStyle,
    initialNumToRender = DEFAULT_INITIAL_NUM_TO_RENDER,
    windowSize = DEFAULT_WINDOW_SIZE,
    maxToRenderPerBatch: _maxToRenderPerBatch = DEFAULT_MAX_TO_RENDER_PER_BATCH,
    inverted = false,
    numColumns,
  } = props;

  const scrollViewRef = useRef<ScrollViewRef>(null);
  const onEndReachedCalledRef = useRef(false);
  const prevDataLengthRef = useRef(data.length);
  const containerSizeRef = useRef(0);

  // Track the visible window via state so re-renders occur when it changes
  const [visibleRange, setVisibleRange] = useState<[number, number]>([
    0,
    Math.min(initialNumToRender - 1, Math.max(data.length - 1, 0)),
  ]);

  // Resolve the item size for the scrolling axis
  const itemSize = horizontal
    ? (itemWidth ?? estimatedItemSize)
    : (itemHeight ?? estimatedItemSize);

  // In grid mode, we work in units of rows. Each row holds numColumns items.
  const columns = (!horizontal && numColumns && numColumns > 1) ? numColumns : 1;
  const rowCount = Math.ceil(data.length / columns);

  // The effective row size is the same as itemSize (each row is one itemSize tall)
  const rowSize = itemSize;

  // Total content size along the scroll axis (rows * rowSize)
  const totalContentSize = rowCount * rowSize;

  // Reset onEndReached guard when data length changes
  useEffect(() => {
    if (data.length !== prevDataLengthRef.current) {
      onEndReachedCalledRef.current = false;
      prevDataLengthRef.current = data.length;
    }
  }, [data.length]);

  // Reset visible range when data shrinks below current range
  useEffect(() => {
    if (data.length === 0) {
      setVisibleRange([0, 0]);
    } else {
      setVisibleRange(([prevStart, prevEnd]) => {
        const maxIdx = Math.max(data.length - 1, 0);
        const clampedStart = Math.min(prevStart, maxIdx);
        const clampedEnd = Math.min(prevEnd, maxIdx);
        if (clampedStart !== prevStart || clampedEnd !== prevEnd) {
          return [clampedStart, clampedEnd];
        }
        return [prevStart, prevEnd];
      });
    }
  }, [data.length]);

  // ── Scroll handler ──────────────────────────────────

  const handleScroll = useCallback(
    (event: ScrollEvent) => {
      // Forward the scroll event to the user's callback
      onScrollProp?.(event);

      const scrollOffset = horizontal ? event.scrollX : event.scrollY;
      const containerSize = horizontal ? event.contentWidth : event.contentHeight;

      // Store container size for imperative scrollToIndex
      containerSizeRef.current = containerSize;

      // Compute the new visible row range
      const [startRow, endRow] = computeVisibleRange(
        scrollOffset,
        containerSize,
        rowSize,
        rowCount,
        windowSize,
      );

      setVisibleRange((prev) => {
        if (prev[0] === startRow && prev[1] === endRow) return prev;
        return [startRow, endRow];
      });

      // Check onEndReached
      if (onEndReached && !onEndReachedCalledRef.current) {
        const distanceFromEnd = totalContentSize - scrollOffset - containerSize;
        const threshold = onEndReachedThreshold * containerSize;
        if (distanceFromEnd <= threshold) {
          onEndReachedCalledRef.current = true;
          onEndReached();
        }
      }
    },
    [
      horizontal,
      onScrollProp,
      rowSize,
      rowCount,
      windowSize,
      onEndReached,
      onEndReachedThreshold,
      totalContentSize,
    ],
  );

  // ── Imperative API ──────────────────────────────────

  useImperativeHandle(ref, () => ({
    scrollToIndex({ index, animated = true }) {
      const rowIndex = Math.floor(index / columns);
      const offset = rowIndex * rowSize;
      scrollViewRef.current?.scrollTo(
        horizontal
          ? { x: offset, animated }
          : { y: offset, animated },
      );
    },
    scrollToOffset({ offset, animated = true }) {
      scrollViewRef.current?.scrollTo(
        horizontal
          ? { x: offset, animated }
          : { y: offset, animated },
      );
    },
  }));

  // ── Build the rendered items ────────────────────────

  const renderedContent = useMemo(() => {
    if (data.length === 0) {
      return ListEmptyComponent ?? null;
    }

    // Determine the working data (inverted reverses the order)
    const workingData = inverted ? [...data].reverse() : data;

    const [startRow, endRow] = visibleRange;

    // Spacer sizes
    const topSpacerSize = startRow * rowSize;
    const bottomSpacerSize = Math.max(0, (rowCount - endRow - 1) * rowSize);

    // Build the spacer style along the scroll axis
    const topSpacerStyle: Style = horizontal
      ? { width: topSpacerSize, flexShrink: 0 }
      : { height: topSpacerSize, flexShrink: 0 };

    const bottomSpacerStyle: Style = horizontal
      ? { width: bottomSpacerSize, flexShrink: 0 }
      : { height: bottomSpacerSize, flexShrink: 0 };

    // Render visible rows
    const items: React.ReactNode[] = [];

    for (let rowIdx = startRow; rowIdx <= endRow; rowIdx++) {
      if (columns > 1) {
        // Grid mode: render a row of N columns
        const rowItems: React.ReactNode[] = [];
        for (let col = 0; col < columns; col++) {
          const dataIndex = rowIdx * columns + col;
          if (dataIndex >= workingData.length) {
            // Empty cell filler for incomplete last row
            rowItems.push(
              <Box key={`empty-${col}`} style={{ flexGrow: 1, flexBasis: 0 }} />,
            );
          } else {
            const item = workingData[dataIndex];
            // Use original index for keyExtractor (before inversion)
            const originalIndex = inverted
              ? data.length - 1 - dataIndex
              : dataIndex;
            const key = keyExtractor(item, originalIndex);
            rowItems.push(
              <React.Fragment key={key}>
                {renderItem({ item, index: originalIndex })}
              </React.Fragment>,
            );
          }
        }

        items.push(
          <Box
            key={`row-${rowIdx}`}
            style={{ flexDirection: 'row', ...( itemHeight ? { height: itemHeight } : {}) }}
          >
            {rowItems}
          </Box>,
        );
      } else {
        // Single column (or horizontal) mode
        const dataIndex = rowIdx;
        if (dataIndex < workingData.length) {
          const item = workingData[dataIndex];
          const originalIndex = inverted
            ? data.length - 1 - dataIndex
            : dataIndex;
          const key = keyExtractor(item, originalIndex);

          // Add separator before the item (except for the first visible item
          // that is also the first data item)
          const showSeparator =
            ItemSeparatorComponent != null && dataIndex > 0;

          items.push(
            <React.Fragment key={key}>
              {showSeparator && ItemSeparatorComponent}
              {renderItem({ item, index: originalIndex })}
            </React.Fragment>,
          );
        }
      }
    }

    return (
      <>
        {ListHeaderComponent}
        <Box style={topSpacerStyle} />
        {items}
        <Box style={bottomSpacerStyle} />
        {ListFooterComponent}
      </>
    );
  }, [
    data,
    inverted,
    visibleRange,
    rowSize,
    rowCount,
    columns,
    horizontal,
    itemHeight,
    keyExtractor,
    renderItem,
    ItemSeparatorComponent,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
  ]);

  // ── Container styles ────────────────────────────────

  // The outer ScrollView style
  const scrollViewStyle: Style = {
    ...(style || {}),
  };

  // The inner content container direction
  const contentDirection: Style = {
    ...(contentContainerStyle || {}),
  };

  if (inverted) {
    contentDirection.flexDirection = horizontal
      ? 'row'
      : 'column';
    // We handle inversion by reversing the data array rather than CSS
    // flex-direction reversal, because spacer-based virtualization math
    // is simpler with a natural top-to-bottom / left-to-right layout.
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={scrollViewStyle}
      horizontal={horizontal}
      onScroll={handleScroll}
    >
      <Box style={contentDirection}>
        {renderedContent}
      </Box>
    </ScrollView>
  );
}

// ── forwardRef wrapper with generic support ───────────

export const FlatList = forwardRef(FlatListInner) as <T>(
  props: FlatListProps<T> & { ref?: React.Ref<FlatListRef> },
) => React.ReactElement | null;
