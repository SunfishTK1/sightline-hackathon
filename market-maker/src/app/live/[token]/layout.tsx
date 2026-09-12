export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="gotchu-live-bg min-h-full overflow-x-hidden text-[#142016]">{children}</div>
  );
}
