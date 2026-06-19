/** Permite clics en capas Radix portaleadas (Select, menús, popover) sin cerrar el diálogo. */
export function isRadixPortaledLayerTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('[data-slot="select-content"]') != null ||
    target.closest('[data-slot="dropdown-menu-content"]') != null ||
    target.closest('[data-slot="popover-content"]') != null ||
    target.closest('[role="listbox"]') != null ||
    target.closest('[data-radix-popper-content-wrapper]') != null
  );
}

export function shouldBlockDialogOutsideDismiss(
  closeOnOutsideClick: boolean,
  originalEvent: Event
): boolean {
  if (closeOnOutsideClick) return false;
  return !isRadixPortaledLayerTarget(originalEvent.target);
}
