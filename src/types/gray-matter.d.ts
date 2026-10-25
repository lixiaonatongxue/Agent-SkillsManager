// gray-matter ships no TypeScript declarations and has no @types package;
// this minimal declaration covers the API skillpkg uses.
declare module 'gray-matter' {
  export interface GrayMatterFile {
    data: Record<string, unknown>;
    content: string;
    excerpt?: string;
    orig: string | Buffer;
  }

  function matter(
    source: string | Buffer,
    options?: Record<string, unknown>,
  ): GrayMatterFile;

  export default matter;
}
