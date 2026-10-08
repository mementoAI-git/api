import {it, vi, afterAll} from 'vitest';

export const after = afterAll;
export const mock = {
  restoreAll: () => vi.restoreAllMocks(),
  method(object: object, key: string, implementation: (...args: any[]) => any) {
    const spy = vi
      .spyOn(object as any, key as any)
      .mockImplementation(implementation);
    return {
      mock: {
        get calls() {
          return spy.mock.calls.map(arguments_ => ({
            arguments: arguments_ as any[],
          }));
        },
        callCount: () => spy.mock.calls.length,
        restore: () => spy.mockRestore(),
        mockImplementation: (fn: (...args: any[]) => any) =>
          spy.mockImplementation(fn),
      },
    };
  },
};
export type TestContext = {mock: typeof mock};
export function test(name: string, run: (context: TestContext) => unknown) {
  it(name, async () => {
    await run({mock});
  });
}
export default test;
