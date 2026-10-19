type AvatarProps = { name: string };

export function Avatar({ name }: AvatarProps) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
      {initials}
    </div>
  );
}
