import { useState } from 'react'
import type { ProvisioningStatus } from '@shared/types'

interface WizardProps {
  status: ProvisioningStatus
  onDone: () => void
}

type Step = 'identity' | 'cameras' | 'applying'

/**
 * Мастер первого запуска станции.
 *   1. Идентичность: STATION_ID + STATION_TOKEN.
 *   2. Камеры: число подключённых (подсказка по /dev/video*) или «Пропустить».
 * По завершении плеер пишет .env камеры, перезапускает её и стартует показ.
 */
export function Wizard({ status, onDone }: WizardProps): JSX.Element {
  const [step, setStep] = useState<Step>('identity')
  const [stationId, setStationId] = useState('')
  const [stationToken, setStationToken] = useState('')
  const [cameraCount, setCameraCount] = useState(
    status.detectedCameras.length > 0 ? status.detectedCameras.length : 4
  )
  const [error, setError] = useState<string | null>(null)

  const idValid = stationId.trim().length > 0 && stationToken.trim().length > 0

  const apply = async (count: number): Promise<void> => {
    setStep('applying')
    setError(null)
    try {
      const res = await window.cannect.provision({
        stationId: stationId.trim(),
        stationToken: stationToken.trim(),
        cameraCount: count
      })
      if (!res.ok) {
        setError('Не удалось применить настройки')
        setStep('cameras')
        return
      }
      if (res.cameraEnv && !res.cameraEnv.ok) {
        window.cannect.log('warn', `camera env: ${res.cameraEnv.reason ?? 'ошибка'}`)
      }
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setStep('cameras')
    }
  }

  return (
    <div className="wizard">
      <div className="wizard__card">
        <h1 className="wizard__title">Настройка станции</h1>

        {step === 'identity' && (
          <>
            <p className="wizard__hint">
              Введите идентификаторы станции (как в cannect-web; должны совпадать с камерой).
            </p>
            <label className="wizard__label">
              STATION_ID
              <input
                className="wizard__input"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                placeholder="6a2699575a677a6355883ea2"
                autoFocus
                spellCheck={false}
              />
            </label>
            <label className="wizard__label">
              STATION_TOKEN
              <input
                className="wizard__input"
                value={stationToken}
                onChange={(e) => setStationToken(e.target.value)}
                placeholder="секрет станции"
                type="password"
                spellCheck={false}
              />
            </label>
            <button className="wizard__btn" disabled={!idValid} onClick={() => setStep('cameras')}>
              Далее →
            </button>
          </>
        )}

        {step === 'cameras' && (
          <>
            <p className="wizard__hint">
              {status.cameraInstalled
                ? `Камер обнаружено (по /dev/video*): ${status.detectedCameras.length}. Это оценка — укажите фактическое число подключённых камер.`
                : 'Модуль камеры на этой банке не найден — шаг можно пропустить (показ работает без камер).'}
            </p>
            {status.cameraInstalled && (
              <label className="wizard__label">
                Число камер
                <input
                  className="wizard__input"
                  type="number"
                  min={0}
                  max={8}
                  value={cameraCount}
                  onChange={(e) => setCameraCount(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            )}
            {error && <p className="wizard__error">{error}</p>}
            <div className="wizard__row">
              <button className="wizard__btn wizard__btn--ghost" onClick={() => void apply(-1)}>
                Пропустить камеры
              </button>
              {status.cameraInstalled && (
                <button className="wizard__btn" onClick={() => void apply(cameraCount)}>
                  Сохранить и запустить
                </button>
              )}
            </div>
          </>
        )}

        {step === 'applying' && <p className="wizard__hint">Применяю настройки…</p>}
      </div>
    </div>
  )
}
