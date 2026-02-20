/**
 * Navigation utility for list-based components
 */

/**
 * Creates a circular list navigation function
 * @param length - Function returning the current list length
 * @param getIndex - Function returning the current selected index
 * @param setIndex - Function to set the new selected index
 * @returns A move function that takes a delta and updates the index
 */
export function createListNavigation(
  length: () => number,
  getIndex: () => number,
  setIndex: (i: number) => void
) {
  return (delta: number) => {
    const len = length()
    if (len === 0) return
    let next = getIndex() + delta
    if (next < 0) next = len - 1
    if (next >= len) next = 0
    setIndex(next)
  }
}
