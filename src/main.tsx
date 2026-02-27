import { render } from "preact";
import { App } from "./app";
import "./styles/index.css";
import "./styles/schedule.css";

render(<App />, document.getElementById("app")!);
