import { element, inputState } from "../harness.mjs";

export const v_flex = () => element("v_flex");
export const h_flex = () => element("h_flex");
export const InputState = { new: inputState };
export const Input = { new: (state) => element("input", { state }) };
export const TextareaState = { new: inputState };
export const Textarea = { new: (state) => element("textarea", { state }) };
