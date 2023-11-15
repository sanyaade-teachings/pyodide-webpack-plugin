import { Parser as AcornParser, Node } from "acorn";
import { importAssertions } from "acorn-import-assertions";
import esbuild from "esbuild";
import { LoaderContext } from "webpack";
const parser = AcornParser.extend(importAssertions as typeof importAssertions);
const walk = require("acorn-walk");

interface LoaderOptions {
  isModule: boolean;
  globalLoadPyodide: boolean;
}

class PyodideParser {
  ast: Node;
  options: LoaderOptions;
  source: string;
  delta: number;
  constructor(source: string, options: LoaderOptions) {
    this.delta = 0;
    this.ast = parser.parse(source, {
      ecmaVersion: 2020,
      sourceType: options.isModule ? "module" : "script",
    });
    this.options = options;
    this.source = source;
  }
  parse() {
    // eslint-disable-next-line
    const self = this;
    walk.simple(this.ast, {
      ExpressionStatement(node) {
        self.walkExpressionStatement(node);
      },
    });
  }
  replace(statement: Node, str: string) {
    const len = statement.end - statement.start;
    const start = this.source.slice(0, statement.start + this.delta);
    const end = this.source.slice(statement.end + this.delta);
    this.source = `${start}${str}${end}`;
    this.delta += str.length - len;
    return str;
  }
  walkExpressionStatement(statement) {
    // getting dumb here. Just want to do some quick things.
    if (this.options.globalLoadPyodide) {
      return;
    }
    const assignment = statement.expression?.left?.object;
    if (assignment?.type !== "Identifier" || assignment?.name !== "globalThis") {
      return;
    }
    // remove global load pyodide
    this.replace(statement, "({});");
  }
}

function addNamedExports(source, options) {
  // convoluted way to inject exports. In the future if this
  // gets too complicated opt for a js compiler that can take in
  // estree AST and manipulate the AST tree directly instead.
  // for now though this works and keeps dependencies down to a minimum
  if (options.isModule) {
    // esm module already has exports like we expect
    return source;
  }
  const newSource = source.split("\n");
  const commonExports = "module.exports = {loadPyodide: loadPyodide.loadPyodide};";
  for (let i = 0; i < newSource.length; i++) {
    if (!newSource[i].includes("sourceMappingURL")) continue;
    newSource.splice(i, 0, commonExports);
    break;
  }
  return newSource.join("\n");
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fc<T>(v: any) {
  return v as T;
}

export default function (source) {
  // @ts-expect-error this has a type any, but we know this is a loader context
  const self: LoaderContext<LoaderOptions> = fc<LoaderContext<LoaderOptions>>(this);
  const options: LoaderOptions = self.getOptions();
  if (options.isModule) {
    const code = esbuild.transformSync(source, { banner: "const module={exports:{}};", format: "cjs" }).code;
    return `export const loadPyodide = eval(${JSON.stringify(code)});\n`;
  }
  // this._module.parser.state.module = this._module;
  // parse the original parser... causes errors because we do not want this to
  // actually be evaluated and added to webpack.
  // const ast = this._module.parser.parse(source, {
  //   module: this._module,
  //   current: this._module,
  //   options: {},
  //   source: source
  // });
  // parse with our own parser

  const p = new PyodideParser(source, options);
  p.parse();
  const finalSource = addNamedExports(p.source, options);
  return `module.exports = eval(${JSON.stringify(finalSource)})`;
}
