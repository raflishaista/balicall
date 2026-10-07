import { useState, useMemo, useEffect } from 'react';
import {
  formatDateToInput,
  formatTimeToInput,
  generateRecommendedSlug,
  calculateEndTime,
  validateScheduleTime,
  type ScheduleValidationResult,
} from './scheduleValidation.ts';

export interface UseScheduleFormParams {
  employeeId?: string;
  employeeName?: string;
  department?: string;
  initialDate?: Date;
}

export interface UseScheduleFormReturn {
  date: string;
  setDate: (value: string) => void;
  startTime: string;
  setStartTime: (value: string) => void;
  endTime: string;
  setEndTime: (value: string) => void;
  durationMinutes: number;
  setDurationMinutes: (value: number) => void;
  title: string;
  setTitle: (value: string) => void;
  roomSlug: string;
  setRoomSlug: (value: string) => void;
  isSlugManual: boolean;
  setIsSlugManual: (value: boolean) => void;
  description: string;
  setDescription: (value: string) => void;
  activeHostId: string;
  setActiveHostId: (value: string) => void;
  activeHostName: string;
  setActiveHostName: (value: string) => void;
  activeDept: string;
  setActiveDept: (value: string) => void;
  todayDateStr: string;
  isSelectedDateToday: boolean;
  currentHourMinuteStr: string;
  validation: ScheduleValidationResult;
  handleDurationPreset: (minutes: number) => void;
  handleStartTimeChange: (newStartTime: string) => void;
  handleDateChange: (newDate: string) => void;
  handleTitleChange: (newTitle: string) => void;
  handleRoomSlugChange: (newSlug: string) => void;
  resetForm: () => void;
}

export function useScheduleForm({
  employeeId = 'BT-10492',
  employeeName = 'Rafli Aditya',
  department = 'NOC & Core Network',
  initialDate,
}: UseScheduleFormParams = {}): UseScheduleFormReturn {
  const now = initialDate || new Date();
  const defaultStart = new Date(now.getTime() + (15 - (now.getMinutes() % 15 || 15)) * 60000);
  if (defaultStart.getTime() <= now.getTime()) {
    defaultStart.setMinutes(defaultStart.getMinutes() + 15);
  }
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60000);

  const [date, setDate] = useState(() => formatDateToInput(defaultStart));
  const [startTime, setStartTime] = useState(() => formatTimeToInput(defaultStart));
  const [endTime, setEndTime] = useState(() => formatTimeToInput(defaultEnd));
  const [durationMinutes, setDurationMinutes] = useState(60);

  const [title, setTitle] = useState('');
  const [roomSlug, setRoomSlug] = useState('');
  const [isSlugManual, setIsSlugManual] = useState(false);
  const [description, setDescription] = useState('');
  const [activeHostId, setActiveHostId] = useState(employeeId);
  const [activeHostName, setActiveHostName] = useState(employeeName);
  const [activeDept, setActiveDept] = useState(department);

  // Sync with user's persona if it was updated from outside
  useEffect(() => {
    if (employeeId && !title) {
      setActiveHostId(employeeId);
      setActiveHostName(employeeName);
      setActiveDept(department);
    }
  }, [employeeId, employeeName, department, title]);

  // Minimum allowed date string: YYYY-MM-DD
  const todayDateStr = formatDateToInput(new Date());
  const isSelectedDateToday = date === todayDateStr;
  const currentHourMinuteStr = formatTimeToInput(new Date());

  const validation = useMemo(() => {
    return validateScheduleTime(date, startTime, endTime);
  }, [date, startTime, endTime]);

  const handleDurationPreset = (minutes: number) => {
    setDurationMinutes(minutes);
    if (!startTime) return;
    setEndTime(calculateEndTime(startTime, minutes));
  };

  const handleStartTimeChange = (newStartTime: string) => {
    setStartTime(newStartTime);
    if (!newStartTime) return;
    setEndTime(calculateEndTime(newStartTime, durationMinutes));
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    if (!isSlugManual && title) {
      setRoomSlug(generateRecommendedSlug(title, newDate));
    }
  };

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (!isSlugManual || !roomSlug || roomSlug === generateRecommendedSlug(title, date)) {
      setRoomSlug(generateRecommendedSlug(newTitle, date));
    }
  };

  const handleRoomSlugChange = (newSlug: string) => {
    setRoomSlug(newSlug);
    if (!newSlug.trim()) {
      setIsSlugManual(false);
    } else {
      const autoSlug = generateRecommendedSlug(title, date);
      setIsSlugManual(newSlug !== autoSlug);
    }
  };

  const resetForm = () => {
    setTitle('');
    setRoomSlug('');
    setDescription('');
    setIsSlugManual(false);
  };

  return {
    date,
    setDate,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    durationMinutes,
    setDurationMinutes,
    title,
    setTitle,
    roomSlug,
    setRoomSlug,
    isSlugManual,
    setIsSlugManual,
    description,
    setDescription,
    activeHostId,
    setActiveHostId,
    activeHostName,
    setActiveHostName,
    activeDept,
    setActiveDept,
    todayDateStr,
    isSelectedDateToday,
    currentHourMinuteStr,
    validation,
    handleDurationPreset,
    handleStartTimeChange,
    handleDateChange,
    handleTitleChange,
    handleRoomSlugChange,
    resetForm,
  };
}
