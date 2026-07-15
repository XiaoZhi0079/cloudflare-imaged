import { statSync } from "node:fs";

export function selectLargestFile(files, getSize = (path) => statSync(path).size) {
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }

  return files.reduce((largest, candidate) => (
    getSize(candidate) > getSize(largest) ? candidate : largest
  ));
}
