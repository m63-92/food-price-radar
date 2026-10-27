import { Database, LineChart, PlayCircle } from 'lucide-react';

/** Supabase 미설정 시 첫 화면: 설정 안내 + 데모(가상 데이터) 둘러보기 */
export function Setup({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card w-full max-w-xl p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-700 text-white" aria-hidden>
            <LineChart size={18} />
          </div>
          <h1 className="text-lg font-bold">식자재 가격 레이더</h1>
          <span className="chip bg-amber-100 text-amber-800">설정 필요</span>
        </div>
        <p className="text-sm leading-6 text-slate-600">
          서버 데이터베이스(Supabase)가 연결되지 않았습니다. 상품·수정값·가격 이력은 서버 DB 에만 저장되므로, 운영하려면 아래 설정이 필요합니다.
        </p>
        <ol className="mt-4 space-y-2 text-[13px] leading-5 text-slate-700">
          <li className="flex gap-2">
            <Database size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <span>
              Supabase 프로젝트 생성 → <code className="rounded bg-slate-100 px-1">supabase/migrations</code> SQL 적용 → 관리자 계정 생성
            </span>
          </li>
          <li className="flex gap-2">
            <Database size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <span>
              빌드 환경변수 <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code>, <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_ANON_KEY</code> 설정 (README 참고)
            </span>
          </li>
        </ol>
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium">먼저 화면을 둘러보시겠어요?</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-500">데모 모드는 명세의 계산 검증용 가상 데이터만 보여주며 실제 쇼핑몰 가격이 아닙니다. 변경 내용은 이 브라우저에만 저장되고 실제 수집은 실행되지 않습니다.</p>
          <button className="btn-primary mt-3" onClick={onDemo}>
            <PlayCircle size={16} /> 데모 모드로 둘러보기
          </button>
        </div>
      </div>
    </div>
  );
}
