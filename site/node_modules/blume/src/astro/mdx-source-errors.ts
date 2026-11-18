/**
 * A Vite plugin that names an `.mdx` page's file on an error the page throws
 * while it renders. A `{…}` expression that reads a name nothing defines
 * (`{user.name}`, or `{{version}}` on a site without that variable) compiles,
 * then throws a `ReferenceError` from inside the page's module, and Astro pins
 * it on the route that rendered it: the catch-all every page shares. Setting
 * the error's `id`, as Vite does for a module that fails, points it at the
 * page's file instead, so the build report can find the expression (see
 * `cli/build-failure.ts`) and the dev overlay shows the page.
 *
 * It runs after `@astrojs/mdx` and wraps the module's `MDXContent`, the
 * function the compiler emits for the body and Astro's `Content` export calls
 * by name. A module without one is left alone.
 */

/** The Vite plugin slice this needs (structurally typed, like Blume's other plugins). */
export interface MdxSourceErrorsPlugin {
  enforce: "post";
  name: string;
  transform: (code: string, id: string) => { code: string; map: null } | null;
}

const MDX_CONTENT = /^\s*function MDXContent\(/mu;

/** The statement that wraps `MDXContent` so its errors carry `id`. */
const wrapContent = (id: string): string => `
MDXContent = ((render, id) => function MDXContent(props) {
  try {
    return render(props);
  } catch (error) {
    if (error instanceof Error && !("id" in error)) error.id = id;
    throw error;
  }
})(MDXContent, ${JSON.stringify(id)});`;

export const mdxSourceErrorsPlugin = (): MdxSourceErrorsPlugin => ({
  enforce: "post",
  name: "blume:mdx-source-errors",
  // A query (`?astroPropagatedAssets`) marks another module made from the
  // same file, which holds no body.
  transform(code, id) {
    return id.endsWith(".mdx") && MDX_CONTENT.test(code)
      ? { code: code + wrapContent(id), map: null }
      : null;
  },
});
