import { useState, useEffect, useCallback } from 'react';

type TimePeriod = 'day' | 'night';

const DAY_COLOR = '#e0f2fe';
const NIGHT_COLOR = '#0f172a';

const DAY_START = 6;
const DAY_END = 18;

function getCurrentPeriod(hour: number): TimePeriod {
  return hour >= DAY_START && hour < DAY_END ? 'day' : 'night';
}

function getNextTransitionTime(): number {
  const now = new Date();
  const currentHour = now.getHours();
  
  let nextTransitionHour: number;
  if (currentHour >= DAY_START && currentHour < DAY_END) {
    nextTransitionHour = DAY_END;
  } else {
    nextTransitionHour = DAY_START + 24;
  }
  
  const nextTransition = new Date(now);
  nextTransition.setHours(nextTransitionHour, 0, 0, 0);
  
  return nextTransition.getTime() - now.getTime();
}

export function TimeBasedBackground() {
  const [period, setPeriod] = useState<TimePeriod>(() => {
    const now = new Date();
    return getCurrentPeriod(now.getHours());
  });

  const updatePeriod = useCallback(() => {
    const now = new Date();
    setPeriod(getCurrentPeriod(now.getHours()));
  }, []);

  useEffect(() => {
    const interval = setInterval(updatePeriod, 60000);
    
    const delay = getNextTransitionTime();
    const timeout = setTimeout(updatePeriod, delay);
    
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [updatePeriod]);

  const backgroundColor = period === 'day' ? DAY_COLOR : NIGHT_COLOR;

  return (
    <div 
      className="fixed inset-0 z-0"
      style={{
        backgroundColor,
        transition: 'background-color 2s ease-in-out',
      }}
      aria-hidden="true"
    />
  );
}