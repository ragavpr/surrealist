import autoFixAnim from "~/assets/animation/autofix.json";
import { useStable } from "~/hooks/stable";
import { ContentPane } from "~/components/Pane";
import { useDebounced } from "~/hooks/debounce";
import { CodeEditor } from "~/components/CodeEditor";
import { ActionIcon, Group, Stack, Tooltip } from "@mantine/core";
import { useConfigStore } from '~/stores/config';
import { iconBraces, iconServer, iconStar, iconText } from "~/util/icons";
import { selectionChanged, surql, surqlTableCompletion, surqlVariableCompletion } from "~/util/editor/extensions";
import { TabQuery } from "~/types";
import { Icon } from "~/components/Icon";
import { format_query, validate_query } from "~/generated/surrealist-embed";
import { showError, tryParseParams } from "~/util/helpers";
import { Text } from "@mantine/core";
import { HtmlPortalNode, OutPortal } from "react-reverse-portal";
import { SelectionRange } from "@codemirror/state";
import { useIntent } from "~/hooks/url";
import { HoverIcon } from "~/components/HoverIcon";

const VARIABLE_PATTERN = /(?<!let\s)\$\w+/gi;
const RESERVED_VARIABLES = new Set([
	'auth',
	'token',
	'scope',
	'session',
	'before',
	'after',
	'value',
	'input',
	'this',
	'parent',
	'event',
]);

export interface QueryPaneProps {
	activeTab: TabQuery;
	showVariables: boolean;
	switchPortal?: HtmlPortalNode<any>;
	setIsValid: (isValid: boolean) => void;
	setShowVariables: (show: boolean) => void;
	onSaveQuery: () => void;
	onSelectionChange: (value: SelectionRange) => void;
}

export function QueryPane({
	activeTab,
	showVariables,
	setIsValid,
	switchPortal,
	setShowVariables,
	onSaveQuery,
	onSelectionChange,
}: QueryPaneProps) {
	const { updateQueryTab } = useConfigStore.getState();

	const setQueryForced = useStable((query: string) => {
		const error = validate_query(query);

		setIsValid(!error);

		updateQueryTab({
			id: activeTab.id,
			query
		});
	});

	const scheduleSetQuery = useDebounced(200, setQueryForced);

	const handleFormat = useStable(() => {
		const formatted = format_query(activeTab.query);

		// NOTE replace with lezer tree based system
		if (formatted) {
			let output = '';
			let indent = 0;
			let skipSpace = false;
			const containedIn: string[] = [];

			const newline = () => {
				output += '\n' + ' '.repeat(indent * 4);
				skipSpace = true;
			};

			const seek = (i: number, text: string) => {
				return formatted.slice(i, i + text.length) === text;
			};

			for (let i = 0; i < formatted.length; i++) {
				const char = formatted.charAt(i);
				let doNewline = false;

				if (char == ' ' && skipSpace) {
					continue;
				}

				if (["{", "["].includes(containedIn.at(-1) as string) &&  char == ',') {
					doNewline = true;
				} else if (char == '{' || char == '(' || char == '[') {
					indent++;
					doNewline = true;
					containedIn.push(char);
				} else if (char == '}' || char == ')' || char == ']') {
					indent--;
					newline();
					containedIn.pop();
				}

				if (seek(i, 'WHERE') || seek(i, 'ORDER') || seek(i, 'GROUP') || seek(i, 'START') || seek(i, 'LIMIT') || seek(i, 'AND') || seek(i, 'OR')) {
					newline();
				}

				output += char;

				if (char == ';') {
					output += '\n';
				} else if (doNewline) {
					newline();
				} else if (skipSpace) {
					skipSpace = false;
				}
			}

			updateQueryTab({
				id : activeTab.id,
				query: output
			});
		} else {
			showError({
				title: 'Formatting failed',
				subtitle: 'Could not format query'
			});
		}
	});

	const toggleVariables = useStable(() => {
		setShowVariables(!showVariables);
	});

	const inferVariables = useStable(() => {
		if (!activeTab) return;

		const query = activeTab.query;
		const matches = query.match(VARIABLE_PATTERN) || [];

		const currentVars = tryParseParams(activeTab.variables);
		const currentKeys = Object.keys(currentVars);

		const variables = matches
			.map((v) => v.slice(1))
			.filter((v) => !RESERVED_VARIABLES.has(v) && !currentKeys.includes(v));

		const newVars = variables.reduce((acc, v) => {
			acc[v] = "";
			return acc;
		}, {} as Record<string, any>);

		const mergedVars = {
			...currentVars,
			...newVars
		};

		setShowVariables(true);
		updateQueryTab({
			id: activeTab.id,
			variables: JSON.stringify(mergedVars, null, 4)
		});
	});

	const setSelection = useDebounced(350, onSelectionChange);

	useIntent("format-query", handleFormat);
	useIntent("infer-variables", inferVariables);

	return (
		<ContentPane
			title="Query"
			icon={iconServer}
			rightSection={
				switchPortal ? (
					<OutPortal node={switchPortal} />
				) : (
					<Group gap="sm">
						<Tooltip label="Save query">
							<ActionIcon
								onClick={onSaveQuery}
								variant="light"
							>
								<Icon path={iconStar} />
							</ActionIcon>
						</Tooltip>

						<Tooltip label="Format query">
							<ActionIcon
								onClick={handleFormat}
								variant="light"
							>
								<Icon path={iconText} />
							</ActionIcon>
						</Tooltip>

						<Tooltip maw={175} multiline label={
							<Stack gap={4}>
								<Text>Infer variables from query</Text>
								<Text c="dimmed" size="sm">
									Automatically add missing variables.
								</Text>
							</Stack>
						}>
							<HoverIcon
								color="slate"
								onClick={inferVariables}
								animation={autoFixAnim}
							/>
						</Tooltip>

						<Tooltip label={showVariables ? "Hide variables" : "Show variables"}>
							<ActionIcon
								onClick={toggleVariables}
								variant="light"
							>
								<Icon path={iconBraces} />
							</ActionIcon>
						</Tooltip>
					</Group>
				)
			}
		>
			<CodeEditor
				value={activeTab.query}
				onChange={scheduleSetQuery}
				extensions={[
					surql(),
					surqlTableCompletion(),
					surqlVariableCompletion(),
					selectionChanged(setSelection)
				]}
			/>
		</ContentPane>
	);
}
