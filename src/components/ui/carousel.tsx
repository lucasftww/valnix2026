import * as React from "react";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];

type CarouselProps = {
  opts?: CarouselOptions;
  plugins?: CarouselPlugin;
  orientation?: "horizontal" | "vertical";
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextProps = {
  carouselRef: ReturnType<typeof useEmblaCarousel>[0];
  api: ReturnType<typeof useEmblaCarousel>[1];
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
} & CarouselProps;

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const context = React.useContext(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
}

const Carousel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & CarouselProps>(
  ({ orientation = "horizontal", opts, setApi, plugins, className, children, ...props }, ref) => {
    const [carouselRef, api] = useEmblaCarousel(
      {
        ...opts,
        axis: orientation === "horizontal" ? "x" : "y",
      },
      plugins,
    );
    const [canScrollPrev, setCanScrollPrev] = React.useState(false);
    const [canScrollNext, setCanScrollNext] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const isPointerDownRef = React.useRef(false);
    const hasDraggedRef = React.useRef(false);

    const setDraggingAttribute = React.useCallback((dragging: boolean) => {
      if (!rootRef.current) return;
      rootRef.current.dataset.carouselDragging = dragging ? "true" : "false";
    }, []);

    const onSelect = React.useCallback((api: CarouselApi) => {
      if (!api) {
        return;
      }

      setCanScrollPrev(api.canScrollPrev());
      setCanScrollNext(api.canScrollNext());
    }, []);

    const handlePointerDown = React.useCallback(() => {
      isPointerDownRef.current = true;
      hasDraggedRef.current = false;
      setDraggingAttribute(false);
    }, [setDraggingAttribute]);

    const handlePointerUp = React.useCallback(() => {
      isPointerDownRef.current = false;
      hasDraggedRef.current = false;
      setDraggingAttribute(false);
    }, [setDraggingAttribute]);

    const handleScroll = React.useCallback(() => {
      if (!isPointerDownRef.current || hasDraggedRef.current) return;
      hasDraggedRef.current = true;
      setDraggingAttribute(true);
    }, [setDraggingAttribute]);

    const scrollPrev = React.useCallback(() => {
      api?.scrollPrev();
    }, [api]);

    const scrollNext = React.useCallback(() => {
      api?.scrollNext();
    }, [api]);

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          scrollPrev();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          scrollNext();
        }
      },
      [scrollPrev, scrollNext],
    );

    const setRootRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;

        if (typeof ref === "function") {
          ref(node);
          return;
        }

        if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref],
    );

    React.useEffect(() => {
      if (!api || !setApi) {
        return;
      }

      setApi(api);
    }, [api, setApi]);

    React.useEffect(() => {
      if (!api) {
        return;
      }

      onSelect(api);
      api.on("reInit", onSelect);
      api.on("select", onSelect);
      api.on("pointerDown", handlePointerDown);
      api.on("pointerUp", handlePointerUp);
      api.on("scroll", handleScroll);
      api.on("settle", handlePointerUp);

      return () => {
        api.off("select", onSelect);
        api.off("reInit", onSelect);
        api.off("pointerDown", handlePointerDown);
        api.off("pointerUp", handlePointerUp);
        api.off("scroll", handleScroll);
        api.off("settle", handlePointerUp);
      };
    }, [api, onSelect, handlePointerDown, handlePointerUp, handleScroll]);

    React.useEffect(() => {
      const node = rootRef.current;
      if (!node) return;

      const resetDragging = () => handlePointerUp();

      node.addEventListener("touchend", resetDragging, { passive: true });
      node.addEventListener("touchcancel", resetDragging, { passive: true });
      node.addEventListener("pointercancel", resetDragging);
      window.addEventListener("pointerup", resetDragging);
      window.addEventListener("touchend", resetDragging, { passive: true });
      window.addEventListener("mouseup", resetDragging);
      window.addEventListener("blur", resetDragging);

      return () => {
        node.removeEventListener("touchend", resetDragging);
        node.removeEventListener("touchcancel", resetDragging);
        node.removeEventListener("pointercancel", resetDragging);
        window.removeEventListener("pointerup", resetDragging);
        window.removeEventListener("touchend", resetDragging);
        window.removeEventListener("mouseup", resetDragging);
        window.removeEventListener("blur", resetDragging);
      };
    }, [handlePointerUp]);

    const contextValue = React.useMemo(
      () => ({
        carouselRef,
        api: api,
        opts,
        orientation: orientation || (opts?.axis === "y" ? "vertical" : "horizontal"),
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
      }),
      [carouselRef, api, opts, orientation, scrollPrev, scrollNext, canScrollPrev, canScrollNext],
    );

    return (
      <CarouselContext.Provider value={contextValue}>
        <div
          ref={setRootRef}
          onKeyDownCapture={handleKeyDown}
          className={cn("relative", className)}
          role="region"
          data-carousel-dragging="false"
          aria-label="Carrossel de conteúdo"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  },
);
Carousel.displayName = "Carousel";

const CarouselContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { carouselRef, orientation } = useCarousel();

    return (
      <div
        ref={carouselRef}
        className="carousel-viewport overflow-hidden"
      >
        <div
          ref={ref}
          className={cn("carousel-track flex", orientation === "horizontal" ? "-ml-4" : "-mt-4 flex-col", className)}
          {...props}
        />
      </div>
    );
  },
);
CarouselContent.displayName = "CarouselContent";

const CarouselItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { orientation } = useCarousel();

    return (
      <div
        ref={ref}
        className={cn("min-w-0 shrink-0 grow-0 basis-full", orientation === "horizontal" ? "pl-4" : "pt-4", className)}
        {...props}
      />
    );
  },
);
CarouselItem.displayName = "CarouselItem";

const CarouselPrevious = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, variant = "outline", size = "icon", ...props }, ref) => {
    const { orientation, scrollPrev, canScrollPrev } = useCarousel();

    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn(
          "absolute h-12 w-12 rounded-full",
          orientation === "horizontal"
            ? "-left-12 top-1/2 -translate-y-1/2"
            : "-top-12 left-1/2 -translate-x-1/2 rotate-90",
          className,
        )}
        disabled={!canScrollPrev}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); scrollPrev(); }}
        aria-label="Slide anterior"
        {...props}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
    );
  },
);
CarouselPrevious.displayName = "CarouselPrevious";

const CarouselNext = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  ({ className, variant = "outline", size = "icon", ...props }, ref) => {
    const { orientation, scrollNext, canScrollNext } = useCarousel();

    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        className={cn(
          "absolute h-12 w-12 rounded-full",
          orientation === "horizontal"
            ? "-right-12 top-1/2 -translate-y-1/2"
            : "-bottom-12 left-1/2 -translate-x-1/2 rotate-90",
          className,
        )}
        disabled={!canScrollNext}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); scrollNext(); }}
        aria-label="Próximo slide"
        {...props}
      >
        <ArrowRight className="h-5 w-5" />
      </Button>
    );
  },
);
CarouselNext.displayName = "CarouselNext";

export { type CarouselApi, Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext };
