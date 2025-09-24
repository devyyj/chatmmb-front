// 시간 관련 유틸은 분리하여 테스트/재사용 용이
export const formatHMS = () =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
