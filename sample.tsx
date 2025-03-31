import { FC, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useGridInstance } from "./Hooks/useGridInstance";
import { useRecoilValue } from "recoil";
import { useDebounce } from "../../hooks/useDebounce";
import BaseGridCellManager from "./GridCellManager/BaseGridCellManager";
import { getSafeRowKey } from "./SupportFunctions/baseGridFunctions";
import styles from "./Styles/basegrid.module.css";
import { useResizeObserver } from "../../hooks/useResizeObserver";
import BaseGridEndRow from "./GridCellManager/BaseGridEndRow";
import { useHasScroll } from "../../hooks/useHasScroll";

// I added this here for future use. Maybe there would be a use case in the future when we would want to control these variables from the server or fine tune performance for easier use.
const RENDER_PROCESSOR_CONFIGURATIONS = {
  ROW_HEIGHT: 49, // These are directly tied to the height in the CSS for base_grid_row
  BUFFER_SIZE: 12, // Buffer size for rows added before and after view
  MAX_VISIBLE_ROWS: 40, // Maximum number of rows to be displayed at once
};

type BaseGridRenderProcessorScrollState = {
  startIndex: number;
  endIndex: number;
  resetAmount: number;
};

type BaseGridRenderProcessor_v3_Properties = {
  uiid?: string;
};

const BaseGridRenderProcessor_v3: FC<BaseGridRenderProcessor_v3_Properties> = ({
  uiid = "NO_UIID_FOUND",
}) => {
  const { instanceSelector, instanceInternalSelector, setInternalInstance } =
    useGridInstance(uiid, "BaseGridRenderProcessor_v3");

  const wrapperRef = useRef<any>(null);
  const containerRef = useRef<any>(null);
  const scrollRef = useRef<any>(null);
  const resizeResult = useResizeObserver(wrapperRef, []);
  const instance = useRecoilValue(instanceSelector());
  const internalInstance = useRecoilValue(instanceInternalSelector());

  const [scrollState, setScrollState] =
    useState<BaseGridRenderProcessorScrollState>({
      startIndex: 0,
      endIndex: RENDER_PROCESSOR_CONFIGURATIONS.MAX_VISIBLE_ROWS,
      resetAmount: 0,
    });

  const { hasScroll } = useHasScroll(wrapperRef);
  const [isAtBottom, setIsAtBottom] = useState(false);
  const [scrollEvent, setScrollEvent] = useState<any>(null);

  const debouncedScrollEvent = useDebounce(scrollEvent, 20);

  const totalRows = internalInstance?.sortedAndFilteredData.length ?? 0;

  const calcGridHeight = useCallback(
    () => totalRows * RENDER_PROCESSOR_CONFIGURATIONS.ROW_HEIGHT,
    [totalRows]
  );

  const scrollToTop = useCallback(() => {
    if (
      wrapperRef !== undefined &&
      wrapperRef !== null &&
      wrapperRef.current !== undefined &&
      wrapperRef.current !== null
    ) {
      wrapperRef.current.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  }, []);

  // Calculate visible rows based on scroll position
  const calculateVisibleRange = useCallback(
    (
      scrollTop: number,
      viewportHeight: number
    ): BaseGridRenderProcessorScrollState => {
      // Calculate the first visible row
      const firstVisibleRow = Math.floor(
        scrollTop / RENDER_PROCESSOR_CONFIGURATIONS.ROW_HEIGHT
      );

      // Calculate how many rows can fit in the viewport
      const visibleRowCount = Math.ceil(
        viewportHeight / RENDER_PROCESSOR_CONFIGURATIONS.ROW_HEIGHT
      );

      // Max row amount
      const maxRowsToShow = RENDER_PROCESSOR_CONFIGURATIONS.MAX_VISIBLE_ROWS;

      // Calculate the middle point of the viewport
      const middle = firstVisibleRow + visibleRowCount / 2;

      // Calculate index positions
      const baseStartIndex = Math.max(
        0,
        Math.floor(middle - maxRowsToShow / 2)
      );
      const baseEndIndex = Math.min(totalRows, baseStartIndex + maxRowsToShow);

      // Finalize index positions and resetAmount offset
      const finalStartIndex =
        baseEndIndex === totalRows
          ? Math.max(0, totalRows - maxRowsToShow)
          : baseStartIndex;

      const finalEndIndex =
        finalStartIndex === 0
          ? Math.min(totalRows, maxRowsToShow)
          : baseEndIndex;

      // Check if we're at or near the bottom
      const totalHeight = calcGridHeight();
      const scrollBottom = scrollTop + viewportHeight;
      const isBottom =
        totalHeight - scrollBottom <
        RENDER_PROCESSOR_CONFIGURATIONS.ROW_HEIGHT * 2; // Within 2 rows of bottom
      setIsAtBottom(isBottom);

      return {
        startIndex: finalStartIndex,
        endIndex: finalEndIndex,
        resetAmount:
          finalStartIndex * RENDER_PROCESSOR_CONFIGURATIONS.ROW_HEIGHT,
      };
    },
    [totalRows]
  );

  const updateCalculationRangeCallback = useCallback(() => {
    if (wrapperRef.current === undefined && wrapperRef.current === null) {
      return false;
    }

    const newScrollState = calculateVisibleRange(
      wrapperRef.current.scrollTop,
      wrapperRef.current.clientHeight
    );

    setScrollState(newScrollState);

    return true;
  }, [calculateVisibleRange]);

  const renderedRows = useMemo(() => {
    const visibleData = internalInstance.sortedAndFilteredData.slice(
      scrollState.startIndex,
      scrollState.endIndex
    );

    const rowsToRender = visibleData.map((row, index) => {
      const rowKey = getSafeRowKey(row);

      return (
        <BaseGridCellManager
          key={`${rowKey}_${scrollState.startIndex + index}`}
          uiid={uiid}
          rowKey={rowKey}
          rowIndex={scrollState.startIndex + index}
          row={row}
          columns={instance?.columns ?? []}    
        />
      );
    });

    if (
      isAtBottom &&
      internalInstance.sortedAndFilteredData.length >
        RENDER_PROCESSOR_CONFIGURATIONS.MAX_VISIBLE_ROWS &&
      containerRef.current.clientHeight !== 0 // I added this to prevent the BaseGridEndRow from "flash" rendering before the grid it self hasn't fully rendered.
    ) {
      rowsToRender.push(
        <BaseGridEndRow
          key={crypto.randomUUID()}
          rowHeight={RENDER_PROCESSOR_CONFIGURATIONS.ROW_HEIGHT}
          scrollToTop={scrollToTop}
        />
      );
    }

    instance.events?.onInitMount?.(true);

    return rowsToRender;
  }, [
    scrollState,
    internalInstance.sortedAndFilteredData,
    instance?.columns,
    uiid,
  ]);

  useEffect(() => {
    if (debouncedScrollEvent?.target) {
      updateCalculationRangeCallback();
    }
  }, [debouncedScrollEvent]);

  // We want this useEffect to call this when either the sortedAndFilteredData or when the grid container size changes view the useResizeObserver - (see resizeResult)
  useEffect(() => {
    if (wrapperRef.current) {
      updateCalculationRangeCallback();
    }
  }, [
    internalInstance.sortedAndFilteredData,
    resizeResult,
    internalInstance?.refreshAfterAddRow,
  ]);

  useEffect(() => {
    setInternalInstance({
      hasScrollBar: hasScroll ?? false,
    });
  }, [hasScroll]);

  return (
    <div
      className={styles.true_base_grid_render_wrapper}
      ref={wrapperRef}
      onScroll={setScrollEvent}
    >
      <div
        className={styles.true_base_grid_render_container}
        ref={containerRef}
        style={{
          // DEV Note:
          // This tricks the user into think the scroll looks "endless", when infact we're just shifting a portion of the grid up or down depending on the
          // number of rows added or removed from the actually row container. This is not to be confused with the true_base_grid_scroll_height container as
          // the is a fixed height based on the number of rows (or length of the result set, however you want to view it as).
          transform: `translateY(${scrollState.resetAmount}px)`,
        }}
      >
        {renderedRows}
      </div>
      <div
        className={styles.true_base_grid_scroll_height}
        ref={scrollRef}
        style={{
          height: `${calcGridHeight()}px`,
        }}
      ></div>
    </div>
  );
};

export default BaseGridRenderProcessor_v3;

rubber duck
