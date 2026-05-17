import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import type { ReactNode } from "react";

/**
 * Isolated wrapper around `@hello-pangea/dnd` (≈80 KB). Imported lazily by
 * CategoryManager so the dnd library only loads when an admin actually opens
 * the Categories tab — most admin sessions never touch this page.
 */
export interface CategoryDnDItem {
  id: string;
}

export interface CategoryDnDWrapperProps<T extends CategoryDnDItem> {
  items: T[];
  onDragEnd: (result: DropResult) => void;
  renderItem: (item: T, index: number, providedProps: unknown) => ReactNode;
}

export function CategoryDnDWrapper<T extends CategoryDnDItem>({
  items,
  onDragEnd,
  renderItem,
}: CategoryDnDWrapperProps<T>) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="categories">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
            {items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(dragProvided) => <>{renderItem(item, index, dragProvided)}</>}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
