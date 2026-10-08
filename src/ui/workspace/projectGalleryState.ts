import { create } from "zustand";
export const useProjectGallery = create<{ open: boolean }>(() => ({ open: false }));
export function beginProjectGallery() { useProjectGallery.setState({ open: true }); }
export function closeProjectGallery() { useProjectGallery.setState({ open: false }); }
