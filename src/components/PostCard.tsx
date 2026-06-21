import {
	faBookmark,
	faComment,
	faHeart,
	faRetweet,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { formatDistanceToNow } from "date-fns";
import parse, { type DOMNode } from "html-react-parser";
import type { mastodon } from "masto";
import { useEffect, useState } from "react";
import { LazyLoadImage } from "react-lazy-load-image-component";
import { fetchMisskeyReactions, type MisskeyReactions } from "../misskey";

const SHORTCODE_RE = /:([a-zA-Z0-9_]+):/g;

function buildEmojiMap(
	emojis: mastodon.v1.CustomEmoji[],
): Record<string, mastodon.v1.CustomEmoji> {
	return Object.fromEntries(emojis.map((e) => [e.shortcode, e]));
}

function renderWithEmoji(
	text: string,
	emojis: mastodon.v1.CustomEmoji[],
): React.ReactNode {
	if (!emojis.length) return text;
	const emojiMap = buildEmojiMap(emojis);
	return text.split(SHORTCODE_RE).map((part, i) => {
		const e = i % 2 === 1 ? emojiMap[part] : undefined;
		if (!e) return part;
		return (
			<img
				// biome-ignore lint/suspicious/noArrayIndexKey: positionally stable split output
				key={i}
				src={e.staticUrl}
				alt={`:${e.shortcode}:`}
				title={`:${e.shortcode}:`}
				className="emoji"
			/>
		);
	});
}

// Parse server HTML and substitute custom emoji into TEXT NODES ONLY. Emoji
// become React <img> elements (src passed as a prop, so it's escaped) — never
// string-concatenated into the markup, which would let a hostile emoji URL
// inject breakout tags or corrupt an attribute/URL that happens to contain a
// ":shortcode:" substring.
export function renderContent(
	html: string,
	emojis: mastodon.v1.CustomEmoji[],
): React.ReactNode {
	if (!emojis.length) return parse(html);
	return parse(html, {
		replace: (domNode: DOMNode) => {
			if (domNode.type === "text") {
				const text = (domNode as unknown as { data: string }).data;
				if (text.includes(":")) return <>{renderWithEmoji(text, emojis)}</>;
			}
		},
	});
}

import {
	favouriteStatus,
	formatHandle,
	reblogStatus,
	unfavouriteStatus,
	unreblogStatus,
} from "../mastodon";

interface PostCardProps {
	status: mastodon.v1.Status;
	instanceUrl: string;
	accessToken: string;
	onSubscribe: (handle: string) => void;
	isSubscribed: (handle: string) => boolean;
}

function MediaAttachments({
	attachments,
}: {
	attachments: mastodon.v1.MediaAttachment[];
}) {
	if (attachments.length === 0) return null;

	const images = attachments.filter(
		(a) => a.type === "image" || a.type === "gifv",
	);

	return (
		<div
			className={`grid gap-1 mt-2 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
		>
			{attachments.map((attachment) => {
				const width = attachment.meta?.original?.width;
				const height = attachment.meta?.original?.height;
				const aspectRatio =
					width && height ? `${width} / ${height}` : undefined;
				if (attachment.type === "image" || attachment.type === "gifv") {
					return (
						<a
							key={attachment.id}
							href={attachment.url ?? "#"}
							target="_blank"
							rel="noopener noreferrer"
							className="block w-full bg-gray-100 dark:bg-gray-800 rounded overflow-hidden"
							style={aspectRatio ? { aspectRatio } : undefined}
						>
							<LazyLoadImage
								src={attachment.previewUrl ?? attachment.url ?? ""}
								alt={attachment.description ?? ""}
								className="w-full h-full object-cover"
								wrapperClassName="w-full h-full"
								placeholder={
									<div className="w-full h-full animate-pulse bg-gray-200 dark:bg-gray-700" />
								}
							/>
						</a>
					);
				}
				if (attachment.type === "video" || attachment.type === "audio") {
					return (
						// biome-ignore lint/a11y/useMediaCaption: user-generated content, captions unavailable
						<video
							key={attachment.id}
							src={attachment.url ?? ""}
							controls
							width={width}
							height={height}
							className="rounded w-full max-h-64"
							style={aspectRatio ? { aspectRatio } : undefined}
						/>
					);
				}
				return null;
			})}
		</div>
	);
}

function CardPreview({ card }: { card: mastodon.v1.PreviewCard | null }) {
	if (!card || !card.url) return null;

	const aspectRatio =
		card.width && card.height ? `${card.width} / ${card.height}` : undefined;

	return (
		<a
			href={card.url}
			target="_blank"
			rel="noopener noreferrer"
			className="block mt-2 border rounded overflow-hidden hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
		>
			{card.image && (
				<div
					className="w-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
					style={aspectRatio ? { aspectRatio } : undefined}
				>
					<LazyLoadImage
						src={card.image}
						alt={card.title ?? ""}
						className="w-full h-full object-cover"
						wrapperClassName="w-full h-full"
						placeholder={
							<div className="w-full h-full animate-pulse bg-gray-200 dark:bg-gray-700" />
						}
					/>
				</div>
			)}
			<div className="p-2">
				<div className="font-medium text-sm line-clamp-2">{card.title}</div>
				{card.description && (
					<div className="text-xs text-gray-500 mt-1 line-clamp-2">
						{card.description}
					</div>
				)}
				<div className="text-xs text-blue-500 mt-1 truncate">{card.url}</div>
			</div>
		</a>
	);
}

function AccountInfo({ account }: { account: mastodon.v1.Account }) {
	const handle = formatHandle(account);

	return (
		<div className="flex items-center gap-2 min-w-0">
			<a href={account.url} target="_blank" rel="noopener noreferrer">
				<LazyLoadImage
					src={account.avatar}
					alt={account.displayName}
					className="w-10 h-10 rounded-full flex-shrink-0"
					placeholder={
						<div className="w-10 h-10 rounded-full animate-pulse bg-gray-200 dark:bg-gray-700" />
					}
				/>
			</a>
			<div className="min-w-0 flex-1">
				<a
					href={account.url}
					target="_blank"
					rel="noopener noreferrer"
					className="font-semibold text-sm block truncate hover:underline"
				>
					{renderWithEmoji(account.displayName || account.acct, account.emojis)}
				</a>
				<div className="text-xs text-gray-500 flex items-center gap-2">
					<a
						href={account.url}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:underline truncate"
					>
						{handle}
					</a>
					<span className="flex-shrink-0">
						{Number(account.followersCount ?? 0).toLocaleString()} followers
					</span>
				</div>
			</div>
		</div>
	);
}

export function PostCard({
	status,
	instanceUrl,
	accessToken,
	onSubscribe,
	isSubscribed,
}: PostCardProps) {
	const [cwOpen, setCwOpen] = useState(false);
	const actual = status.reblog ?? status;
	const hasCw = !!actual.spoilerText;
	const showContent = !hasCw || cwOpen;

	const [reblogged, setReblogged] = useState(actual.reblogged ?? false);
	const [favourited, setFavourited] = useState(actual.favourited ?? false);
	const [reblogsCount, setReblogsCount] = useState(actual.reblogsCount ?? 0);
	const [favouritesCount, setFavouritesCount] = useState(
		actual.favouritesCount ?? 0,
	);
	const [reblogging, setReblogging] = useState(false);
	const [favouriting, setFavouring] = useState(false);
	const [misskeyReactions, setMisskeyReactions] = useState<{
		reactions: MisskeyReactions;
		reactionEmojis: Record<string, string>;
	} | null>(null);

	// Unsubscribing is destructive and the button sits among the action icons, so
	// require a confirming second tap: the first tap on "Subscribed" arms it
	// ("Unsubscribe?"), a second removes it. Subscribing (additive) stays one tap.
	// The armed state self-reverts so a stray first tap doesn't linger.
	const [confirmingUnsub, setConfirmingUnsub] = useState(false);
	useEffect(() => {
		if (!confirmingUnsub) return;
		const id = setTimeout(() => setConfirmingUnsub(false), 3000);
		return () => clearTimeout(id);
	}, [confirmingUnsub]);

	const handleSubscribeClick = () => {
		const handle = formatHandle(actual.account);
		if (!isSubscribed(handle)) {
			onSubscribe(handle); // additive — one tap
			return;
		}
		if (!confirmingUnsub) {
			setConfirmingUnsub(true); // arm; a second tap confirms
			return;
		}
		onSubscribe(handle); // confirmed — unsubscribe
		setConfirmingUnsub(false);
	};

	useEffect(() => {
		if (!actual.url) return;
		fetchMisskeyReactions(actual.url)
			.then(setMisskeyReactions)
			.catch(() => {});
	}, [actual.url]);

	// Guard against a non-empty but unparseable createdAt (corrupted cache /
	// bridged status): an Invalid Date would throw in formatDistanceToNow and
	// the error boundary would silently drop the whole post.
	const parsedCreatedAt = new Date(actual.createdAt ?? "");
	const createdAt = Number.isNaN(parsedCreatedAt.getTime())
		? new Date()
		: parsedCreatedAt;
	const relativeTime = formatDistanceToNow(createdAt, { addSuffix: true });
	const absoluteTime = createdAt.toLocaleString();

	const handleReblog = async () => {
		if (reblogging || !actual.id) return;
		setReblogging(true);
		const wasReblogged = reblogged;
		setReblogged(!wasReblogged);
		setReblogsCount((c) => c + (wasReblogged ? -1 : 1));
		try {
			if (wasReblogged) {
				await unreblogStatus(instanceUrl, actual.id, accessToken);
			} else {
				await reblogStatus(instanceUrl, actual.id, accessToken);
			}
		} catch {
			// revert on failure
			setReblogged(wasReblogged);
			setReblogsCount((c) => c + (wasReblogged ? 1 : -1));
		} finally {
			setReblogging(false);
		}
	};

	const handleFavourite = async () => {
		if (favouriting || !actual.id) return;
		setFavouring(true);
		const wasFavourited = favourited;
		setFavourited(!wasFavourited);
		setFavouritesCount((c) => c + (wasFavourited ? -1 : 1));
		try {
			if (wasFavourited) {
				await unfavouriteStatus(instanceUrl, actual.id, accessToken);
			} else {
				await favouriteStatus(instanceUrl, actual.id, accessToken);
			}
		} catch {
			// revert on failure
			setFavourited(wasFavourited);
			setFavouritesCount((c) => c + (wasFavourited ? 1 : -1));
		} finally {
			setFavouring(false);
		}
	};

	return (
		<article className="border-b border-gray-200 dark:border-gray-700 p-4 overflow-x-hidden">
			{/* Reblog indicator */}
			{status.reblog && (
				<div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
					<FontAwesomeIcon icon={faRetweet} className="text-green-500" />
					<span>
						{renderWithEmoji(
							status.account.displayName || status.account.acct,
							status.account.emojis,
						)}{" "}
						boosted
					</span>
				</div>
			)}

			{/* Author */}
			<AccountInfo account={actual.account} />

			{/* Reply indicator */}
			{actual.inReplyToId && (
				<div className="text-xs text-gray-400 mt-1">↩ In reply to a post</div>
			)}

			{/* Content warning */}
			{hasCw && (
				<div className="mt-2">
					<div className="text-sm font-medium text-orange-600 dark:text-orange-400">
						CW: {actual.spoilerText}
					</div>
					<button
						type="button"
						onClick={() => setCwOpen((v) => !v)}
						className="text-xs text-blue-500 mt-1"
					>
						{cwOpen ? "Hide" : "Show content"}
					</button>
				</div>
			)}

			{/* Post content */}
			{showContent && (
				<div className="mt-2 text-sm [&_a]:text-blue-500 break-words">
					{renderContent(actual.content ?? "", actual.emojis ?? [])}
				</div>
			)}

			{/* Media */}
			{showContent && (actual.mediaAttachments ?? []).length > 0 && (
				<MediaAttachments attachments={actual.mediaAttachments ?? []} />
			)}

			{/* URL preview card */}
			{showContent && actual.card && <CardPreview card={actual.card} />}

			{/* Misskey reactions */}
			{misskeyReactions && (
				<div className="flex flex-wrap gap-1 mt-2">
					{Object.entries(misskeyReactions.reactions).map(([emoji, count]) => {
						const shortcode = emoji.replace(/^:|:$/g, "");
						const imgUrl = misskeyReactions.reactionEmojis[shortcode];
						return (
							<span
								key={emoji}
								className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs"
							>
								{imgUrl ? (
									<img src={imgUrl} alt={emoji} className="emoji" />
								) : (
									<span>{emoji}</span>
								)}
								<span className="text-gray-500 dark:text-gray-400">
									{count}
								</span>
							</span>
						);
					})}
				</div>
			)}

			{/* Footer */}
			<div className="flex items-center justify-between mt-3 text-gray-400 text-xs">
				<div className="flex items-center gap-4">
					<button
						type="button"
						onClick={handleSubscribeClick}
						className={`text-xs px-2 py-1 rounded border transition-colors ${
							confirmingUnsub
								? "bg-red-100 border-red-300 text-red-700 dark:bg-red-900 dark:border-red-700 dark:text-red-300"
								: isSubscribed(formatHandle(actual.account))
									? "border-gray-300 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
									: "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:border-blue-600 dark:hover:bg-blue-500"
						}`}
					>
						{confirmingUnsub
							? "Unsubscribe?"
							: isSubscribed(formatHandle(actual.account))
								? "Subscribed"
								: "+ Subscribe"}
					</button>
					<span className="flex items-center gap-1">
						<FontAwesomeIcon icon={faComment} />
						{actual.repliesCount}
					</span>
					<button
						type="button"
						onClick={handleReblog}
						disabled={reblogging}
						className={`flex items-center gap-1 transition-colors disabled:opacity-50 ${
							reblogged ? "text-green-500" : "hover:text-green-500"
						}`}
					>
						<FontAwesomeIcon icon={faRetweet} />
						{reblogsCount}
					</button>
					<button
						type="button"
						onClick={handleFavourite}
						disabled={favouriting}
						className={`flex items-center gap-1 transition-colors disabled:opacity-50 ${
							favourited ? "text-red-500" : "hover:text-red-500"
						}`}
					>
						<FontAwesomeIcon icon={faHeart} />
						{favouritesCount}
					</button>
					<a
						href={actual.url ?? "#"}
						target="_blank"
						rel="noopener noreferrer"
						className="flex items-center gap-1 hover:text-blue-500 transition-colors"
					>
						<FontAwesomeIcon icon={faBookmark} />
					</a>
				</div>
				<a
					href={actual.url ?? "#"}
					target="_blank"
					rel="noopener noreferrer"
					title={absoluteTime}
					className="hover:underline"
				>
					{relativeTime}
				</a>
			</div>
		</article>
	);
}
