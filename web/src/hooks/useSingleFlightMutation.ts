import { useCallback, useRef } from "react";
import {
  DefaultError,
  MutateOptions,
  QueryClient,
  useMutation,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";

// useMutation, but a call made while another is still in flight is dropped (mutate) or joins it
// (mutateAsync). Why it's needed even though every submit button has disabled={isPending}: React Query
// hands isPending to the component through setTimeout(0) and a render, so for that tick the button is
// still enabled. When the main thread is busy, the browser queues both clicks of a double click and
// runs them before that timer; each would POST with its own Idempotency-Key, and the gateway would see
// two different requests and create two records (reproduced in Edge). A ref changes synchronously, so
// the second click sees it at once.
export function useSingleFlightMutation<TData = unknown, TError = DefaultError, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
  queryClient?: QueryClient,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const mutation = useMutation(options, queryClient);
  const inFlight = useRef<Promise<TData> | null>(null);
  const { mutateAsync: run } = mutation;

  const mutateAsync = useCallback(
    (variables: TVariables, callbacks?: MutateOptions<TData, TError, TVariables, TContext>) => {
      if (inFlight.current) return inFlight.current;
      const call = run(variables, callbacks).finally(() => {
        inFlight.current = null;
      });
      inFlight.current = call;
      return call;
    },
    [run],
  );

  const mutate = useCallback(
    (variables: TVariables, callbacks?: MutateOptions<TData, TError, TVariables, TContext>) => {
      if (inFlight.current) return;
      // like useMutation's mutate: the error is in mutation.error and the onError callbacks
      mutateAsync(variables, callbacks).catch(() => {});
    },
    [mutateAsync],
  );

  return { ...mutation, mutate, mutateAsync } as UseMutationResult<TData, TError, TVariables, TContext>;
}
