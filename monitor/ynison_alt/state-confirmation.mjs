/**
 * Do not confuse transport startup time with actual Ynison player frames.
 * RealtimeClient.lastStateAgeMs can be defined before the first state event.
 */
export function confirmedState({receivedState, state}) {
  return receivedState === true && state !== null && state !== undefined;
}
