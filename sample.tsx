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

/* SOLACE COMMENTARY:
    This component is part of a larger group of components that work together to generate a grid that is capable of rendering large amounts of data via windowing. This solution was developed inhouse primarly because 
    we had the need to customize the rendered rows with dynamic heights or other dynamic needs. Additionally, product owners wanted the ability to control the content view the database with ease. Products do 
    exist that support these mechanisms but they are hard to develop agaisnt as they are built generically.

    I've only included this component specifically as the entire codebase it self is hosted on Azure DevOps and is private. I've removed some additional functions out of this sample and changed some names that relate to 
    the business and it's competitors out of respect to company.
*/

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

/* SOLACE COMMENTARY: 
    Notice the component name BaseGridRenderProcessor_v3. This specific component has obviously gone through several iterations. The previous version although it worked and was stable, didn't perform as well as version 3.
    There was a notiable delay/stutter/freezing in scrolling on v2. However, we held onto v2 in the event we needed to roll back for some reason (it fully moved forward and v2 was removed after about 2 months I believe). 
  */

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

  /* SOLACE COMMENTARY: 
      I needed to suppress the noise that the window scroll event produced but I still wanted the end event response so I created this hook to do just that.
  */
  const debouncedScrollEvent = useDebounce(scrollEvent, 20);

  const totalRows = internalInstance?.sortedAndFilteredData.length ?? 0;

    /* SOLACE COMMENTARY: 
        Notice that many of the functions here use useCallback. I do this because they are either directly referenced in the resulting "return" HTML or have some general expense to them
        that would otherwise lock up during the react render lifecycle process and stall rendering a bit.
    */
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

/* SOLACE COMMENTARY: 
    This probably does the most magical part and something I'm really proud of. Without going through it too much, it basically calculates the window-scroll relative to the the content in the center,
    on the top, and on the bottom.

    There is an element called "wrapperRef", which has a height set to it. Again it's the height calculated by the RowHeight[49] * NumberOfRows. This height is fixed for the duration of the grids extistance,
    which gives the user the impression they are looking at a fully loaded grid when infact they are only looking at roughly 60 rows of data.

    Once "calculateVisibleRange" starts it's calculation, it uses "wrapperRef" (scrollTop and clientHeight properties) as guide to determine where the user is in the scroll zone and calculates what rows
    from the data that should be rendered once the scroll event stops.
*/
    
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

    /* SOLACE COMMENTARY:
        The function "renderedRows", is pretty expensive to execute, so I wrapped it in a useMemo hook to save the page from dying. 
        It basically takes a large complex component "BaseGridCellManager" and renders a group of them and spits them out on the page which is what the end user sees a list of rows.
        It listens for a few things things to trigger it's rendering update. One of them being the "scroll" event. So when a user scrolls the "updateCalculationRangeCallback" executes
        and causes a scroll calculation to determine where in the calculated height should the next set of rows render.

        One thing I should note, our data sets we're relatively small per customer and so most of the data the user was seeing was all loaded upfront and not pageinated. At most
        the amount of data that was loaded was about 30,000 rows but on average was closer to around 500 - 1000 rows of data.

        The grid system can do "pagination" but only one via SQL because it can be fed just chunks of data rather than the whole lot but prodcut owners prefered it this way.

        I can elaborate on additional details about this thought process given the time.
    */
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
            /* SOLACE COMMENTARY: 
                This creates an effect that gives the grid an artifical height based on the number of possible rows that can be rendered. 
                So (RowCount[5000] * RowHeight[49]). Rememeber, only about 60 are so rows are actually renedered however.  
            */
          height: `${calcGridHeight()}px`,
        }}
      ></div>
    </div>
  );
};

export default BaseGridRenderProcessor_v3;

/* SOLACE COMMENTARY:
    Theres so much more I could go into detail about but I will say that this chunk of code was done back in 2024, 
    roughly in November and it is really something i'm happy about which is why I wanted to share it with you. Mostly because I developed part of v1 and all of v2,
    and as I progressed through those versions, I felt like I just kept learning more and more about what issues we're going on in previous versions until I landed on this final version,
    which is such a good feeling of progression and learning.

    If only you could see it in action!
*/

Master of my craft - I totally missed this one!
rubber duck
